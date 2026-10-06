import type { AsyncStorageDriver, SetOptions } from '@teactjs/storage';
import { decode } from './kv';
import { resolve, type D1DatabaseLike, type Lazy } from './types';

/** Default table name. */
export const DEFAULT_D1_TABLE = 'teact_storage';

/** Options for {@link D1Driver}. */
export interface D1DriverOptions {
  /**
   * Table to store entries in. It is created on first use with
   * `CREATE TABLE IF NOT EXISTS <table> (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)`.
   * Must be a plain SQL identifier.
   * @default 'teact_storage'
   */
  table?: string;
}

/** Escape `%`, `_` and `\` for a `LIKE … ESCAPE '\'` pattern. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

/**
 * {@link AsyncStorageDriver} backed by [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite).
 *
 * Unlike KV, D1 is strongly consistent and has no write-rate limit per key, which makes
 * it a good default for bot state on Workers.
 *
 * - **Schema**: `<table>(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)`.
 *   It is created lazily, once per driver instance. `value` is JSON text and `expires_at`
 *   is epoch milliseconds.
 * - **Prefix queries** use `key LIKE ? ESCAPE '\'` with `% _ \` escaped. SQLite's LIKE
 *   ignores ASCII case, so the driver adds an exact, case-sensitive
 *   `substr(key, 1, length(?)) = ?` check.
 * - **Expiry** is filtered on read. Call {@link D1Driver.purgeExpired} from a Cron
 *   Trigger to reclaim space.
 *
 * @example
 * import { env } from 'cloudflare:workers';
 * const driver = new D1Driver(() => env.DB);
 * createBot({ plugins: [storagePlugin({ driver })], ... });
 */
export class D1Driver implements AsyncStorageDriver {
  readonly async = true as const;
  readonly table: string;
  private ready?: Promise<void>;

  /** @param db The D1 binding, or a getter for it (resolved on every call). */
  constructor(private readonly db: Lazy<D1DatabaseLike>, opts: D1DriverOptions = {}) {
    this.table = opts.table ?? DEFAULT_D1_TABLE;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.table)) {
      throw new Error(`[teact/cloudflare] Invalid D1 table name: ${JSON.stringify(this.table)}`);
    }
  }

  /** The resolved binding. */
  get binding(): D1DatabaseLike {
    return resolve(this.db);
  }

  /** Create the table if needed. Runs once per instance and is retried if it fails. */
  ensureTable(): Promise<void> {
    this.ready ??= this.binding
      .prepare(
        `CREATE TABLE IF NOT EXISTS ${this.table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)`,
      )
      .run()
      .then(
        () => undefined,
        (err) => {
          this.ready = undefined;
          throw err;
        },
      );
    return this.ready;
  }

  private async stmt(sql: string, ...params: unknown[]) {
    await this.ensureTable();
    return this.binding.prepare(sql).bind(...params);
  }

  /** `WHERE` fragment + params for live keys under `prefix`. */
  private where(prefix: string): [string, unknown[]] {
    const live = '(expires_at IS NULL OR expires_at > ?)';
    if (!prefix) return [live, [Date.now()]];
    return [
      `key LIKE ? ESCAPE '\\' AND substr(key, 1, length(?)) = ? AND ${live}`,
      [escapeLike(prefix) + '%', prefix, prefix, Date.now()],
    ];
  }

  async get<T>(key: string): Promise<T | undefined> {
    const row = await (
      await this.stmt(`SELECT value FROM ${this.table} WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`, key, Date.now())
    ).first<{ value: string }>();
    return decode(row?.value) as T | undefined;
  }

  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    if (value === undefined) return this.delete(key);
    const expiresAt = opts?.ttl && opts.ttl > 0 ? Date.now() + Math.ceil(opts.ttl) : null;
    await (
      await this.stmt(
        `INSERT INTO ${this.table} (key, value, expires_at) VALUES (?, ?, ?) ` +
          `ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
        key,
        JSON.stringify(value),
        expiresAt,
      )
    ).run();
  }

  async delete(key: string): Promise<void> {
    await (await this.stmt(`DELETE FROM ${this.table} WHERE key = ?`, key)).run();
  }

  async has(key: string): Promise<boolean> {
    const row = await (
      await this.stmt(`SELECT 1 AS found FROM ${this.table} WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)`, key, Date.now())
    ).first();
    return !!row;
  }

  async keys(prefix = ''): Promise<string[]> {
    const [where, params] = this.where(prefix);
    const { results } = await (await this.stmt(`SELECT key FROM ${this.table} WHERE ${where}`, ...params)).all<{ key: string }>();
    return results.map((r) => r.key);
  }

  async clear(prefix = ''): Promise<void> {
    if (!prefix) {
      await (await this.stmt(`DELETE FROM ${this.table}`)).run();
      return;
    }
    await (
      await this.stmt(
        `DELETE FROM ${this.table} WHERE key LIKE ? ESCAPE '\\' AND substr(key, 1, length(?)) = ?`,
        escapeLike(prefix) + '%',
        prefix,
        prefix,
      )
    ).run();
  }

  /** Every live entry under `prefix`, in a single query. */
  async entries(prefix: string): Promise<Array<[string, unknown]>> {
    const [where, params] = this.where(prefix);
    const { results } = await (
      await this.stmt(`SELECT key, value FROM ${this.table} WHERE ${where}`, ...params)
    ).all<{ key: string; value: string }>();
    return results.map((r) => [r.key, decode(r.value)] as [string, unknown]);
  }

  /**
   * Delete expired rows. Expired rows are already invisible to reads; this only frees
   * space. Call it from a scheduled handler, e.g. `scheduled() { await driver.purgeExpired() }`.
   */
  async purgeExpired(): Promise<void> {
    await (await this.stmt(`DELETE FROM ${this.table} WHERE expires_at IS NOT NULL AND expires_at <= ?`, Date.now())).run();
  }
}
