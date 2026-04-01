export interface StorageDriver {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  has(key: string): boolean;
  clear(): void;
  keys(): string[];
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
   * import { RedisDriver } from '@teact/storage-redis';
   * storagePlugin({ driver: new RedisDriver({ url: 'redis://localhost:6379' }) })
   */
  driver?: 'memory' | 'file' | StorageDriver;
  /** File path (only for built-in 'file' driver). */
  path?: string;
}
