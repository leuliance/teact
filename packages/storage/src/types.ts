export interface StorageDriver {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  has(key: string): boolean;
  clear(): void;
  keys(): string[];
}

/** Options accepted by {@link AsyncStorageDriver.set}. */
export interface SetOptions {
  /**
   * Expire the entry after this many milliseconds. `0`, negative or omitted means the
   * entry never expires (every driver follows this rule; see `runDriverConformance`).
   */
  ttl?: number;
}

/**
 * Asynchronous storage backend — Redis, Postgres, MongoDB, Cloudflare KV/D1, etc.
 *
 * Teact reads storage synchronously during render (`useStorage`), so the storage plugin
 * wraps an async driver in a per-update cache: before each update it loads the current
 * chat's keys (`<platform>:<chatId>:*`) with one {@link entries} call, components read
 * from that cache, and every write is awaited before the update finishes — so writes
 * are durable even on serverless/edge, where the isolate freezes after the response.
 *
 * Mark the driver with `async: true` so the plugin can tell it apart from a sync one.
 */
export interface AsyncStorageDriver {
  readonly async: true;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, opts?: SetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Keys, optionally only those starting with `prefix`. */
  keys(prefix?: string): Promise<string[]>;
  /** Remove every key (optionally only those starting with `prefix`). */
  clear(prefix?: string): Promise<void>;
  /**
   * All `[key, value]` pairs whose key starts with `prefix`. Implement it with a single
   * query when the backend allows; the fallback is `keys(prefix)` + one `get` per key.
   */
  entries?(prefix: string): Promise<Array<[string, unknown]>>;
  /**
   * Atomically add `by` (default 1) to the number stored at `key` (a missing key counts
   * as 0) and resolve the new value. `opts.ttl` applies only when the increment creates
   * the key, so a counter keeps its original expiry. Optional: implement it when the
   * backend has an atomic primitive (Redis `INCRBY`, SQL upsert … `RETURNING`, Mongo
   * `$inc`); counters in `@teactjs/plugins` use it to stay correct across instances.
   */
  incr?(key: string, by?: number, opts?: SetOptions): Promise<number>;
  /** Release connections (called from the plugin's `onStop`). */
  close?(): Promise<void>;
}

/** Any storage backend accepted by `storagePlugin` and `createSessionStore`. */
export type AnyStorageDriver = StorageDriver | AsyncStorageDriver;

export interface StoragePluginOptions {
  /**
   * Storage backend.
   * - `'memory'` (default) — in-process Map, lost on restart.
   * - `'file'`  — JSON file, survives restarts.
   * - `StorageDriver` instance — any custom driver (Redis, SQLite, Supabase, etc.).
   *
   * @example
   * // Built-in drivers
   * storagePlugin({ driver: 'memory' })
   * storagePlugin({ driver: 'file', path: './data/store.json' })
   *
   * // Custom driver (community or your own)
   * import { RedisDriver } from '@teactjs/redis';
   * storagePlugin({ driver: new RedisDriver({ client: new Redis(process.env.REDIS_URL) }) })
   */
  driver?: 'memory' | 'file' | StorageDriver | AsyncStorageDriver;
  /** File path (only for built-in 'file' driver). */
  path?: string;
  /**
   * Extra key prefixes to load into the cache before every update (async drivers only).
   * The current chat's keys are always loaded; add e.g. `['global:']` to read shared keys
   * synchronously through `useGlobalStorage()`.
   */
  preload?: string[];
}
