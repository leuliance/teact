import { createRequire } from 'node:module';
import type { AsyncStorageDriver, SetOptions, StorageDriver } from '@teactjs/storage';

/**
 * A prepared statement, as returned by `prepare(sql)` on both `bun:sqlite` and
 * `better-sqlite3`. Parameters are always passed positionally (`?` placeholders),
 * which both libraries accept as spread arguments.
 */
export interface SqliteStatement {
  /** First row, or `null` (bun) / `undefined` (better-sqlite3) when there is none. */
  get(...params: unknown[]): unknown;
  /** Every row. */
  all(...params: unknown[]): unknown[];
  /** Execute without returning rows. Both libraries report `changes`. */
  run(...params: unknown[]): unknown;
}

/**
 * The minimal database surface the driver needs. Satisfied structurally by
 * `Database` from `bun:sqlite` and by `better-sqlite3` instances — no import of
 * either library is required to type it.
 */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  /** Run one or more statements without parameters. */
  exec(sql: string): unknown;
  close(): unknown;
}

/** Options for {@link SqliteDriver}. Pass either `db` or `path`. */
export interface SqliteDriverOptions {
  /**
   * An already-open database (`new Database(...)` from `bun:sqlite` or `better-sqlite3`).
   * The driver never closes a database it did not open, unless `closeDb` is set.
   */
  db?: SqliteDatabase;
  /**
   * File to open (created if missing). The driver loads `bun:sqlite` lazily (falling back
   * to `better-sqlite3` on Node), enables WAL mode and owns the handle — `close()` closes it.
   * Use `':memory:'` for a throw-away database.
   */
  path?: string;
  /** Table name. Must be a plain identifier (`[A-Za-z_][A-Za-z0-9_]*`). @default 'teact_storage' */
  table?: string;
  /** Close the database in `close()` even when it was passed in via `db`. @default false */
  closeDb?: boolean;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * Validate a table name and return it double-quoted. Throws on anything that is not a
 * plain identifier, so a table name can never inject SQL.
 */
export function quoteSqliteIdent(name: string): string {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw new Error(`[teact/sqlite] Invalid table name ${JSON.stringify(name)}: use letters, digits and _ (not starting with a digit), max 63 chars.`);
  }
  return `"${name}"`;
}

/** Escape `%`, `_` and `\` so `prefix` is matched literally by `LIKE ? ESCAPE '\'`. */
export function escapeLike(prefix: string): string {
  return prefix.replace(/[\\%_]/g, '\\$&') + '%';
}

/** Open a database file with `bun:sqlite`, or `better-sqlite3` when not running on Bun. */
function openDatabase(path: string): SqliteDatabase {
  const req = createRequire(import.meta.url);
  let lastErr: unknown;
  try {
    const { Database } = req('bun:sqlite') as { Database: new (p: string, o?: object) => SqliteDatabase };
    return new Database(path, { create: true });
  } catch (err) { lastErr = err; }
  try {
    const BetterSqlite = req('better-sqlite3') as new (p: string) => SqliteDatabase;
    return new BetterSqlite(path);
  } catch (err) { lastErr = err; }
  throw new Error(
    '[teact/sqlite] Could not open a SQLite database: run on Bun (bun:sqlite) or install better-sqlite3, ' +
    `or pass an open database via { db }. Cause: ${String((lastErr as Error)?.message ?? lastErr)}`,
  );
}

interface Row { key: string; value: string }

/**
 * Synchronous SQLite {@link StorageDriver}.
 *
 * SQLite's API is synchronous, so this driver plugs straight into `storagePlugin` and
 * `useStorage` with no cache layer — every read hits the database and every write is
 * committed before the setter returns.
 *
 * Values are stored as JSON text in `teact_storage(key TEXT PRIMARY KEY, value TEXT NOT NULL,
 * expires_at INTEGER)`; `expires_at` is a Unix-epoch millisecond timestamp. Expired rows are
 * hidden from every read and can be deleted with {@link purgeExpired}.
 *
 * Long-running processes only — SQLite needs a local file, so it does not work on
 * serverless/edge runtimes (use `@teactjs/postgres` with Neon there).
 *
 * @example
 * import { storagePlugin } from '@teactjs/storage';
 * import { SqliteDriver } from '@teactjs/sqlite';
 *
 * createBot({ plugins: [storagePlugin({ driver: new SqliteDriver({ path: './data/bot.db' }) })] });
 *
 * @example
 * // better-sqlite3 on Node
 * import Database from 'better-sqlite3';
 * new SqliteDriver({ db: new Database('./data/bot.db') });
 */
export class SqliteDriver implements StorageDriver {
  /** The underlying database handle — use it for your own tables and queries. */
  readonly db: SqliteDatabase;
  /** Table name (unquoted). */
  readonly table: string;
  private readonly ownsDb: boolean;
  private readonly q: string;
  private readonly stmts = new Map<string, SqliteStatement>();
  private closed = false;
  private asyncView?: SqliteAsyncDriver;

  constructor(opts: SqliteDriverOptions | SqliteDatabase = {}) {
    const o: SqliteDriverOptions = isDatabase(opts) ? { db: opts } : opts;
    this.table = o.table ?? 'teact_storage';
    this.q = quoteSqliteIdent(this.table);
    if (o.db) {
      this.db = o.db;
      this.ownsDb = !!o.closeDb;
    } else if (o.path) {
      this.db = openDatabase(o.path);
      this.ownsDb = true;
      if (o.path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    } else {
      throw new Error('[teact/sqlite] SqliteDriver needs { path } or { db }.');
    }
    this.db.exec(createSqliteTableSql(this.table));
  }

  /** Cached prepared statement. */
  private stmt(sql: string): SqliteStatement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private get live(): string {
    return '(expires_at IS NULL OR expires_at > ?)';
  }

  /** WHERE fragment + params for an optional prefix. */
  private prefixWhere(prefix?: string): [string, unknown[]] {
    if (!prefix) return ['', []];
    // LIKE is case-insensitive for ASCII in SQLite, so confirm with an exact substr compare.
    return [` AND key LIKE ? ESCAPE '\\' AND substr(key, 1, length(?)) = ?`, [escapeLike(prefix), prefix, prefix]];
  }

  /** Read a value, or `undefined` when missing or expired. */
  get<T>(key: string): T | undefined {
    const row = this.stmt(`SELECT value FROM ${this.q} WHERE key = ? AND ${this.live}`).get(key, Date.now()) as
      | { value: string } | null | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  /**
   * Store a JSON-serialisable value. `opts.ttl` (ms) makes it expire.
   * Setting `undefined` deletes the key.
   */
  set<T>(key: string, value: T, opts?: SetOptions): void {
    if (value === undefined) return this.delete(key);
    const expiresAt = opts?.ttl ? Date.now() + opts.ttl : null;
    this.stmt(
      `INSERT INTO ${this.q} (key, value, expires_at) VALUES (?, ?, ?) ` +
      `ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    ).run(key, JSON.stringify(value), expiresAt);
  }

  delete(key: string): void {
    this.stmt(`DELETE FROM ${this.q} WHERE key = ?`).run(key);
  }

  has(key: string): boolean {
    return !!this.stmt(`SELECT 1 AS x FROM ${this.q} WHERE key = ? AND ${this.live}`).get(key, Date.now());
  }

  /** Remove every key, or only those starting with `prefix`. */
  clear(prefix?: string): void {
    if (!prefix) {
      this.stmt(`DELETE FROM ${this.q}`).run();
      return;
    }
    const [where, params] = this.prefixWhere(prefix);
    this.stmt(`DELETE FROM ${this.q} WHERE 1 = 1${where}`).run(...params);
  }

  /** Live keys, sorted, optionally only those starting with `prefix`. */
  keys(prefix?: string): string[] {
    const [where, params] = this.prefixWhere(prefix);
    const rows = this.stmt(`SELECT key FROM ${this.q} WHERE ${this.live}${where} ORDER BY key`)
      .all(Date.now(), ...params) as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }

  /** Live `[key, value]` pairs whose key starts with `prefix`, in one query. */
  entries(prefix = ''): Array<[string, unknown]> {
    const [where, params] = this.prefixWhere(prefix);
    const rows = this.stmt(`SELECT key, value FROM ${this.q} WHERE ${this.live}${where} ORDER BY key`)
      .all(Date.now(), ...params) as Row[];
    return rows.map((r) => [r.key, JSON.parse(r.value)]);
  }

  /** Delete expired rows. Returns how many were removed. */
  purgeExpired(): number {
    const res = this.stmt(`DELETE FROM ${this.q} WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(Date.now()) as
      | { changes?: number | bigint } | undefined;
    return Number(res?.changes ?? 0);
  }

  /**
   * An {@link AsyncStorageDriver} view over this driver (same database, same table).
   * Use it where an async driver is expected — e.g. TTL-aware session stores or code
   * shared with network databases. Always returns the same instance.
   */
  asAsync(): SqliteAsyncDriver {
    return (this.asyncView ??= new SqliteAsyncDriver(this));
  }

  /** Close the database if this driver opened it (or `closeDb` was set). Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stmts.clear();
    if (this.ownsDb) this.db.close();
  }
}

/**
 * {@link AsyncStorageDriver} over a {@link SqliteDriver}. Every method resolves with the
 * synchronous result, so writes are durable before the promise settles.
 *
 * @example
 * const sqlite = new SqliteDriver({ path: './data/bot.db' });
 * runDriverConformance('sqlite', () => sqlite.asAsync(), { describe, test, expect });
 */
export class SqliteAsyncDriver implements AsyncStorageDriver {
  readonly async = true as const;

  /** Wrap an existing {@link SqliteDriver}. Prefer `driver.asAsync()`. */
  constructor(readonly sync: SqliteDriver) {}

  async get<T>(key: string): Promise<T | undefined> { return this.sync.get<T>(key); }
  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> { this.sync.set(key, value, opts); }
  async delete(key: string): Promise<void> { this.sync.delete(key); }
  async has(key: string): Promise<boolean> { return this.sync.has(key); }
  async keys(prefix?: string): Promise<string[]> { return this.sync.keys(prefix); }
  async clear(prefix?: string): Promise<void> { this.sync.clear(prefix); }
  async entries(prefix: string): Promise<Array<[string, unknown]>> { return this.sync.entries(prefix); }
  /** Delete expired rows; resolves with the count. */
  async purgeExpired(): Promise<number> { return this.sync.purgeExpired(); }
  async close(): Promise<void> { this.sync.close(); }
}

/** DDL for the storage table (SQLite dialect) — `CREATE TABLE IF NOT EXISTS` + expiry index. */
export function createSqliteTableSql(table = 'teact_storage'): string {
  const q = quoteSqliteIdent(table);
  const idx = quoteSqliteIdent(`${table}_expires_at_idx`.slice(0, 63));
  return (
    `CREATE TABLE IF NOT EXISTS ${q} (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER);\n` +
    `CREATE INDEX IF NOT EXISTS ${idx} ON ${q} (expires_at) WHERE expires_at IS NOT NULL;`
  );
}

function isDatabase(x: unknown): x is SqliteDatabase {
  return !!x && typeof (x as SqliteDatabase).prepare === 'function';
}
