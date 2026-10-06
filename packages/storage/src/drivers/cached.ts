import type { AsyncStorageDriver, StorageDriver } from '../types';

/**
 * Synchronous view over an {@link AsyncStorageDriver}.
 *
 * `hydrate(prefix)` loads every entry under a prefix into memory; `get`/`has`/`keys` then
 * answer from that cache, and `set`/`delete`/`clear` update the cache immediately and
 * queue the async write. `flush()` resolves once every queued write has landed — the
 * storage plugin awaits it at the end of each update.
 */
export class CachedDriver implements StorageDriver {
  private cache = new Map<string, unknown>();
  private pending = new Set<Promise<void>>();
  private errors: unknown[] = [];
  private prefixes = new Set<string>();

  constructor(readonly backend: AsyncStorageDriver) {}

  /** Replace the cached entries under `prefix` with fresh ones from the backend. */
  async hydrate(prefix: string): Promise<void> {
    this.prefixes.add(prefix);
    const entries = this.backend.entries
      ? await this.backend.entries(prefix)
      : await loadEntries(this.backend, prefix);
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    for (const [key, value] of entries) {
      if (value !== undefined) this.cache.set(key, value);
    }
  }

  /** Wait for all queued writes. Rethrows the first write error, if any. */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    if (this.errors.length) {
      const [first] = this.errors;
      this.errors = [];
      throw first;
    }
  }

  private track(op: Promise<void>): void {
    const p = op.catch((err) => { this.errors.push(err); }).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
    this.track(this.backend.set(key, value));
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.track(this.backend.delete(key));
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear every hydrated prefix (the current chat's keys plus any `preload` prefixes).
   * Never wipes the whole backend — other chats' data lives there too.
   */
  clear(): void {
    for (const prefix of this.prefixes) {
      for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
      this.track(this.backend.clear(prefix));
    }
  }

  /** Keys currently in the cache (only hydrated prefixes). */
  keys(): string[] {
    return [...this.cache.keys()];
  }
}

async function loadEntries(driver: AsyncStorageDriver, prefix: string): Promise<Array<[string, unknown]>> {
  const keys = await driver.keys(prefix);
  const values = await Promise.all(keys.map((k) => driver.get(k)));
  return keys.map((k, i) => [k, values[i]]);
}

/** Whether `driver` is an {@link AsyncStorageDriver}. */
export function isAsyncDriver(driver: unknown): driver is AsyncStorageDriver {
  return !!driver && typeof driver === 'object' && (driver as { async?: unknown }).async === true;
}
