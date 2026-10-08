import type { AsyncStorageDriver, SetOptions } from '@teactjs/storage';
import { closeClient, toQueryFn } from './client';
import type { PostgresClient, QueryFn, Row } from './client';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * Validate an identifier (table or schema name) and return it double-quoted. Only plain
 * identifiers (`[A-Za-z_][A-Za-z0-9_]*`, max 63 chars) are accepted, so names can never
 * inject SQL.
 */
export function quotePgIdent(name: string): string {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw new Error(`[teact/postgres] Invalid identifier ${JSON.stringify(name)}: use letters, digits and _ (not starting with a digit), max 63 chars.`);
  }
  return `"${name}"`;
}

/**
 * Escape `%`, `_` and `\` so `prefix` is matched literally by `LIKE $n ESCAPE '\'`, and
 * append the trailing `%`. Internal (not exported from the package index).
 */
export function escapeLike(prefix: string): string {
  return prefix.replace(/[\\%_]/g, '\\$&') + '%';
}

/** The individual DDL statements behind {@link createTableSql}. */
export function createTableStatements(table = 'teact_storage', schema?: string): string[] {
  const q = (schema !== undefined ? `${quotePgIdent(schema)}.` : '') + quotePgIdent(table);
  const idx = quotePgIdent(`${table}_expires_at_idx`.slice(0, 63));
  return [
    // COLLATE "C" lets prefix LIKE queries use the primary-key b-tree index.
    // JSON (not JSONB): keeps object key order and accepts "\u0000" in strings. Tables
    // created as JSONB by older versions keep working (json → jsonb is an assignment cast).
    `CREATE TABLE IF NOT EXISTS ${q} (key TEXT COLLATE "C" PRIMARY KEY, value JSON NOT NULL, expires_at TIMESTAMPTZ)`,
    `CREATE INDEX IF NOT EXISTS ${idx} ON ${q} (expires_at) WHERE expires_at IS NOT NULL`,
  ];
}

/**
 * DDL for the storage table, for people who run migrations themselves
 * (set `autoMigrate: false` on the driver then).
 *
 * @example
 * console.log(createTableSql()); // paste into a migration
 * // CREATE TABLE IF NOT EXISTS "teact_storage" (key TEXT COLLATE "C" PRIMARY KEY, value JSON NOT NULL, expires_at TIMESTAMPTZ);
 * // CREATE INDEX IF NOT EXISTS "teact_storage_expires_at_idx" ON "teact_storage" (expires_at) WHERE expires_at IS NOT NULL;
 */
export function createTableSql(table = 'teact_storage', schema?: string): string {
  return createTableStatements(table, schema).map((s) => s + ';').join('\n');
}

/**
 * Normalize `SetOptions.ttl`: a positive finite number of ms, or `null` for "never
 * expires" (`0`, negative, `NaN`, `Infinity` or omitted).
 */
function normalizeTtl(ttl: number | undefined): number | null {
  return typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : null;
}

/**
 * SQLSTATEs a concurrent `CREATE … IF NOT EXISTS` can raise when another process creates
 * the same table at the same moment: `23505` unique_violation (on `pg_type`) and `42P07`
 * duplicate_table. The object exists afterwards either way.
 */
const ALREADY_EXISTS = new Set(['23505', '42P07']);

/** Options for {@link PostgresDriver}. */
export interface PostgresDriverOptions {
  /**
   * Database client — auto-detected: `pg` Pool/Client, postgres.js `sql`, Neon `neon()` /
   * `Pool`, PGlite, or a {@link QueryFn}. Wrap with `fromPg` / `fromPostgresJs` / `fromNeon` /
   * `fromPglite` to be explicit.
   */
  client: PostgresClient;
  /** Table name. @default 'teact_storage' */
  table?: string;
  /** Schema (e.g. `'bot'`). Defaults to the connection's `search_path` (usually `public`). */
  schema?: string;
  /** Create the table + index on first use (`CREATE TABLE IF NOT EXISTS`). @default true */
  autoMigrate?: boolean;
  /**
   * End the client in `close()` (called by `storagePlugin` on stop). Leave `false` when the
   * pool is shared with the rest of your app. @default false
   */
  closeClient?: boolean;
}

/**
 * Postgres {@link AsyncStorageDriver}.
 *
 * Stores JSON values in `teact_storage(key TEXT PRIMARY KEY, value JSON NOT NULL,
 * expires_at TIMESTAMPTZ)` (an existing `JSONB` column works too). Expiry is evaluated in SQL against the database clock, writes
 * are single-statement upserts, and `entries(prefix)` loads a chat's keys in one query —
 * exactly what `storagePlugin`'s per-update cache needs.
 *
 * Works with any Postgres: Supabase, Neon (incl. HTTP on the edge), Vercel Postgres,
 * RDS, self-hosted, PGlite. Drizzle/Prisma users can pass the underlying `pg` pool.
 *
 * @example
 * import { Pool } from 'pg';
 * const pg = new PostgresDriver({ client: new Pool({ connectionString: process.env.DATABASE_URL }) });
 * createBot({ plugins: [storagePlugin({ driver: pg })], session: { store: postgresSessionStore(pg) } });
 */
export class PostgresDriver implements AsyncStorageDriver {
  readonly async = true as const;
  /** The client as passed in. */
  readonly client: PostgresClient;
  /** Fully-qualified, quoted table name used in queries. */
  readonly tableRef: string;
  private readonly run: QueryFn;
  private readonly opts: PostgresDriverOptions;
  private ready?: Promise<void>;

  constructor(opts: PostgresDriverOptions) {
    if (!opts || !opts.client) throw new Error('[teact/postgres] PostgresDriver needs { client }.');
    this.opts = opts;
    this.client = opts.client;
    this.run = toQueryFn(opts.client);
    const table = opts.table ?? 'teact_storage';
    this.tableRef = (opts.schema !== undefined ? `${quotePgIdent(opts.schema)}.` : '') + quotePgIdent(table);
    if (opts.autoMigrate === false) this.ready = Promise.resolve();
  }

  /**
   * Create the table if needed (runs once; retried if it failed). Called automatically.
   * Two processes racing `CREATE TABLE IF NOT EXISTS` on a fresh database can make one of
   * them fail with a unique violation on `pg_type` (SQLSTATE 23505) or 42P07; both mean the
   * table now exists, so they count as success.
   */
  migrate(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const sql of createTableStatements(this.opts.table, this.opts.schema)) {
          try {
            await this.run(sql);
          } catch (err) {
            if (!ALREADY_EXISTS.has(String((err as { code?: unknown })?.code))) throw err;
          }
        }
      })().catch((err) => {
        this.ready = undefined;
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * Run any parameterised statement on the same client (`$1`, `$2`, …) and get its rows.
   * Handy from components via `usePostgres().query(...)`.
   */
  async query<R extends Row = Row>(text: string, values?: unknown[]): Promise<R[]> {
    return (await this.run(text, values)) as R[];
  }

  private async exec(text: string, values?: unknown[]): Promise<Row[]> {
    await this.migrate();
    return this.run(text, values);
  }

  private static readonly LIVE = '(expires_at IS NULL OR expires_at > now())';

  async get<T>(key: string): Promise<T | undefined> {
    const rows = await this.exec(
      `SELECT value::text AS value FROM ${this.tableRef} WHERE key = $1 AND ${PostgresDriver.LIVE}`,
      [key],
    );
    return rows.length ? (parseValue(rows[0].value) as T) : undefined;
  }

  /** Upsert a JSON-serialisable value; `opts.ttl` (ms) sets `expires_at`. `undefined` deletes. */
  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    if (value === undefined) return this.delete(key);
    // Values go in as text and are cast server-side, so every client serialises them the same way.
    await this.exec(
      `INSERT INTO ${this.tableRef} (key, value, expires_at) ` +
      `VALUES ($1, $2::text::json, now() + ($3::float8 * interval '1 millisecond')) ` +
      `ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(value), normalizeTtl(opts?.ttl)],
    );
  }

  /**
   * Atomically add `by` (default 1) to the number at `key` and resolve the new value, in
   * one upsert. A missing or expired row counts as 0 and gets `opts.ttl`; a live row keeps
   * its expiry. Rejects when the stored value is not a JSON number. Arithmetic is exact
   * (`numeric`), and works with both `JSON` and legacy `JSONB` value columns.
   */
  async incr(key: string, by = 1, opts?: SetOptions): Promise<number> {
    if (!Number.isFinite(by)) throw new TypeError(`[teact/postgres] incr: \`by\` must be a finite number, got ${by}`);
    const live = '(t.expires_at IS NULL OR t.expires_at > now())';
    const rows = await this.exec(
      `INSERT INTO ${this.tableRef} AS t (key, value, expires_at) ` +
      `VALUES ($1, to_json($2::numeric), now() + ($3::float8 * interval '1 millisecond')) ` +
      `ON CONFLICT (key) DO UPDATE SET ` +
      `value = CASE WHEN ${live} THEN to_json(t.value::text::numeric + $2::numeric) ELSE to_json($2::numeric) END, ` +
      `expires_at = CASE WHEN ${live} THEN t.expires_at ELSE EXCLUDED.expires_at END ` +
      `RETURNING t.value::text AS value`,
      [key, String(by), normalizeTtl(opts?.ttl)],
    );
    return Number(parseValue(rows[0]?.value));
  }

  async delete(key: string): Promise<void> {
    await this.exec(`DELETE FROM ${this.tableRef} WHERE key = $1`, [key]);
  }

  async has(key: string): Promise<boolean> {
    const rows = await this.exec(
      `SELECT 1 AS x FROM ${this.tableRef} WHERE key = $1 AND ${PostgresDriver.LIVE} LIMIT 1`,
      [key],
    );
    return rows.length > 0;
  }

  /** Live keys, sorted, optionally only those starting with `prefix`. */
  async keys(prefix?: string): Promise<string[]> {
    const rows = prefix
      ? await this.exec(
        `SELECT key FROM ${this.tableRef} WHERE key LIKE $1 ESCAPE '\\' AND ${PostgresDriver.LIVE} ORDER BY key`,
        [escapeLike(prefix)],
      )
      : await this.exec(`SELECT key FROM ${this.tableRef} WHERE ${PostgresDriver.LIVE} ORDER BY key`);
    return rows.map((r) => String(r.key));
  }

  /** Remove every key, or only those starting with `prefix`. */
  async clear(prefix?: string): Promise<void> {
    if (prefix) {
      await this.exec(`DELETE FROM ${this.tableRef} WHERE key LIKE $1 ESCAPE '\\'`, [escapeLike(prefix)]);
    } else {
      await this.exec(`DELETE FROM ${this.tableRef}`);
    }
  }

  /** Live `[key, value]` pairs whose key starts with `prefix`, in a single query. */
  async entries(prefix: string): Promise<Array<[string, unknown]>> {
    const rows = await this.exec(
      `SELECT key, value::text AS value FROM ${this.tableRef} ` +
      `WHERE key LIKE $1 ESCAPE '\\' AND ${PostgresDriver.LIVE} ORDER BY key`,
      [escapeLike(prefix)],
    );
    return rows.map((r) => [String(r.key), parseValue(r.value)]);
  }

  /** Delete expired rows; resolves with how many were removed. Run it from a cron if you use TTLs. */
  async purgeExpired(): Promise<number> {
    const rows = await this.exec(
      `WITH d AS (DELETE FROM ${this.tableRef} WHERE expires_at <= now() RETURNING 1) SELECT count(*)::int AS n FROM d`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Ends the client only when `closeClient: true` was set. */
  async close(): Promise<void> {
    if (this.opts.closeClient) await closeClient(this.client);
  }
}

/** `value::text` comes back as a string; tolerate clients that still parse it. */
function parseValue(v: unknown): unknown {
  return typeof v === 'string' ? JSON.parse(v) : v;
}
