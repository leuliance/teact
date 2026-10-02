import type { SessionData, SessionStore } from '../renderer';

/**
 * In-memory session store with TTL-based expiration.
 * Used as the default when no custom `SessionStore` is provided.
 *
 * @example
 * const store = new MemorySessionStore(30 * 60 * 1000); // 30-minute TTL
 */
export class MemorySessionStore implements SessionStore {
  private store = new Map<string, { data: SessionData; expiresAt: number }>();
  private ttl: number;

  /** @param ttl - Time-to-live in milliseconds (default: 24 hours). */
  constructor(ttl = 24 * 60 * 60 * 1000) {
    this.ttl = ttl;
  }

  async get(key: string): Promise<SessionData | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  async set(key: string, data: SessionData): Promise<void> {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

// ---- kvSessionStore ----

/** A Cloudflare Workers KV namespace (structurally). */
interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export interface KVSessionStoreOptions {
  get(key: string): Promise<string | null | undefined>;
  /** Store `value`; `ttlSeconds` is set when the store was given a TTL. */
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  /** Key prefix. @default 'teact:session:' */
  prefix?: string;
  /** Expire idle sessions after this many seconds. */
  ttlSeconds?: number;
}

/**
 * A durable `SessionStore` on top of any async key-value store — Redis, Cloudflare KV,
 * Upstash, Deno KV, a SQL table… Sessions are stored as JSON. Required on serverless,
 * where the default in-memory store doesn't survive between requests.
 *
 * @example Cloudflare Workers KV (pass the namespace directly)
 * createBot({ session: { store: kvSessionStore(env.SESSIONS, { ttlSeconds: 86400 }) } });
 *
 * @example Redis (node-redis v4)
 * kvSessionStore({
 *   get: (k) => redis.get(k),
 *   set: (k, v, ttl) => redis.set(k, v, ttl ? { EX: ttl } : {}),
 *   delete: (k) => redis.del(k),
 * });
 */
export function kvSessionStore(kv: KVSessionStoreOptions): SessionStore;
export function kvSessionStore(kv: KVNamespaceLike, opts?: { prefix?: string; ttlSeconds?: number }): SessionStore;
export function kvSessionStore(
  kv: KVSessionStoreOptions | KVNamespaceLike,
  opts: { prefix?: string; ttlSeconds?: number } = {},
): SessionStore {
  const isCloudflare = typeof (kv as KVNamespaceLike).put === 'function';
  const o: KVSessionStoreOptions = isCloudflare
    ? {
        get: (k) => (kv as KVNamespaceLike).get(k),
        // Cloudflare KV requires expirationTtl >= 60.
        set: (k, v, ttl) => (kv as KVNamespaceLike).put(k, v, ttl ? { expirationTtl: Math.max(60, ttl) } : undefined),
        delete: (k) => (kv as KVNamespaceLike).delete(k),
        ...opts,
      }
    : { ...(kv as KVSessionStoreOptions), ...opts };
  const prefix = o.prefix ?? 'teact:session:';

  return {
    async get(key) {
      const raw = await o.get(prefix + key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as SessionData;
      } catch {
        console.warn(`[teact] Corrupt session JSON for "${key}" — starting fresh.`);
        return null;
      }
    },
    async set(key, data) {
      await o.set(prefix + key, JSON.stringify(data), o.ttlSeconds);
    },
    async delete(key) {
      await o.delete(prefix + key);
    },
  };
}
