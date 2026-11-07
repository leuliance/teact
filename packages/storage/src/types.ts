type MaybePromise<T> = T | Promise<T>;

/**
 * A storage backend. Methods may be synchronous (memory, file) or return promises
 * (Redis, Cloudflare KV, a database) — `useStorage` handles both.
 */
export interface StorageDriver {
  get<T>(key: string): MaybePromise<T | undefined>;
  set<T>(key: string, value: T): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  has(key: string): MaybePromise<boolean>;
  clear(): MaybePromise<void>;
  keys(): MaybePromise<string[]>;
}

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
   * import { RedisDriver } from '@teactjs/storage-redis';
   * storagePlugin({ driver: new RedisDriver({ url: 'redis://localhost:6379' }) })
   */
  driver?: 'memory' | 'file' | StorageDriver;
  /** File path (only for built-in 'file' driver). */
  path?: string;
}
