import type { AsyncStorageDriver, SetOptions } from '@teactjs/storage';
import { resolve, type KVNamespaceLike, type Lazy } from './types';

/** Workers KV rejects `expirationTtl` below 60 seconds. */
export const KV_MIN_TTL_SECONDS = 60;

/**
 * Convert a TTL in milliseconds to KV's `expirationTtl` in seconds: round up, with a
 * floor of {@link KV_MIN_TTL_SECONDS}.
 */
export function kvExpirationTtl(ttlMs: number): number {
  return Math.max(KV_MIN_TTL_SECONDS, Math.ceil(ttlMs / 1000));
}

/** Options for {@link KVDriver}. */
export interface KVDriverOptions {
  /** Prefix prepended to every key, so several bots can share one namespace. */
  namespace?: string;
  /** How many `get`s `entries()` runs at once. @default 50 */
  concurrency?: number;
}

/**
 * {@link AsyncStorageDriver} backed by [Workers KV](https://developers.cloudflare.com/kv/).
 *
 * - Values are stored as JSON text.
 * - **TTL**: KV's minimum `expirationTtl` is 60 seconds, so shorter TTLs are rounded up
 *   to 60s and longer ones up to the next whole second.
 * - `keys()` and `clear()` page through `list({ prefix, cursor })`. `entries()` lists the
 *   keys, then fetches the values in parallel.
 * - **Consistency**: KV is eventually consistent. A write is visible at once in the same
 *   location but can take up to about 60s to show up elsewhere, and KV allows about one
 *   write per second per key. That suits settings, caches and low-churn data. For
 *   per-message state such as counters, multi-step forms or sessions that must be read
 *   back right away, prefer {@link D1Driver}, Durable Objects or Upstash Redis.
 *
 * @example
 * import { env } from 'cloudflare:workers';
 * const driver = new KVDriver(() => env.BOT_KV);           // safe at module scope
 * createBot({ plugins: [storagePlugin({ driver })], ... });
 */
export class KVDriver implements AsyncStorageDriver {
  readonly async = true as const;
  private readonly ns: string;
  private readonly concurrency: number;

  /** @param kv The KV binding, or a getter for it (resolved on every call). */
  constructor(private readonly kv: Lazy<KVNamespaceLike>, opts: KVDriverOptions = {}) {
    this.ns = opts.namespace ?? '';
    this.concurrency = Math.max(1, opts.concurrency ?? 50);
  }

  /** The resolved binding. */
  get binding(): KVNamespaceLike {
    return resolve(this.kv);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return decode(await this.binding.get(this.ns + key, 'text')) as T | undefined;
  }

  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    if (value === undefined) return this.delete(key);
    const text = JSON.stringify(value);
    if (opts?.ttl && opts.ttl > 0) {
      await this.binding.put(this.ns + key, text, { expirationTtl: kvExpirationTtl(opts.ttl) });
    } else {
      await this.binding.put(this.ns + key, text);
    }
  }

  async delete(key: string): Promise<void> {
    await this.binding.delete(this.ns + key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.binding.get(this.ns + key, 'text')) !== null;
  }

  /** Full KV key names (namespace included) under `prefix`, across all pages. */
  private async rawKeys(prefix: string): Promise<string[]> {
    const kv = this.binding;
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix: this.ns + prefix, ...(cursor ? { cursor } : {}) });
      for (const k of page.keys) out.push(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  async keys(prefix = ''): Promise<string[]> {
    const n = this.ns.length;
    return (await this.rawKeys(prefix)).map((k) => k.slice(n));
  }

  async clear(prefix = ''): Promise<void> {
    const kv = this.binding;
    await pool(await this.rawKeys(prefix), this.concurrency, (k) => kv.delete(k));
  }

  /** `list()` + parallel `get()`s, with at most `concurrency` requests in flight. */
  async entries(prefix: string): Promise<Array<[string, unknown]>> {
    const kv = this.binding;
    const keys = await this.rawKeys(prefix);
    const values = await pool(keys, this.concurrency, (k) => kv.get(k, 'text'));
    const n = this.ns.length;
    const out: Array<[string, unknown]> = [];
    keys.forEach((k, i) => {
      // A key can be listed but already expired or deleted.
      if (values[i] !== null) out.push([k.slice(n), decode(values[i])]);
    });
    return out;
  }
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** JSON-parse stored text, tolerating plain strings written by other code. */
export function decode(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
