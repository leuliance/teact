import type { AsyncStorageDriver, SetOptions } from '@teactjs/storage';
import { toRedisCommands, type AnyRedisClient, type RedisClientKind, type RedisCommands } from './client';

/** Options for {@link RedisDriver}. */
export interface RedisDriverOptions {
  /**
   * A Redis client — ioredis, node-redis v4+, Bun's `RedisClient`, `@upstash/redis`, or
   * anything wrapped with a `from*` helper / implementing {@link RedisCommands}.
   * Raw clients are auto-detected.
   */
  client: AnyRedisClient;
  /** Force an adapter instead of auto-detecting the client library. */
  clientKind?: RedisClientKind;
  /**
   * Prefix prepended to every key in Redis (e.g. `'mybot:'`), so several bots or apps can
   * share one database. Keys reported by `keys()`/`entries()` never include it.
   * `clear()` only ever touches keys under the namespace.
   */
  namespace?: string;
  /**
   * Close the client when the driver is closed (the storage plugin closes its driver in
   * `onStop`). Turn it off when the client is shared with other code.
   * @default true
   */
  closeClient?: boolean;
}

/** Escape Redis glob metacharacters (`* ? [ ] \`) so `s` matches literally in `SCAN MATCH`. */
export function escapeGlob(s: string): string {
  return s.replace(/[*?[\]\\]/g, '\\$&');
}

/** How many keys to delete per `DEL` command in `clear()`. */
const DEL_BATCH = 500;

/**
 * {@link AsyncStorageDriver} backed by Redis.
 *
 * - Values are stored as JSON strings (readable from any other Redis client).
 * - `ttl` maps to `SET … PX <ms>`.
 * - Prefix lookups use `SCAN … MATCH <escaped prefix>*` — never `KEYS`, so they don't block
 *   the server — and `entries()` fetches all values with a single `MGET`.
 *
 * @example
 * import Redis from 'ioredis';
 * import { storagePlugin } from '@teactjs/storage';
 * import { RedisDriver } from '@teactjs/redis';
 *
 * const driver = new RedisDriver({ client: new Redis(process.env.REDIS_URL!), namespace: 'mybot:' });
 * createBot({ plugins: [storagePlugin({ driver })], ... });
 */
export class RedisDriver implements AsyncStorageDriver {
  readonly async = true as const;
  /** The normalized client the driver talks to. */
  readonly commands: RedisCommands;
  private readonly ns: string;
  private readonly closeClient: boolean;

  constructor(opts: RedisDriverOptions) {
    this.commands = toRedisCommands(opts.client, opts.clientKind);
    this.ns = opts.namespace ?? '';
    this.closeClient = opts.closeClient ?? true;
  }

  private k(key: string): string {
    return this.ns + key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return decode(await this.commands.get(this.k(key))) as T | undefined;
  }

  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    if (value === undefined) return this.delete(key);
    const ttl = opts?.ttl && opts.ttl > 0 ? Math.ceil(opts.ttl) : undefined;
    await this.commands.set(this.k(key), JSON.stringify(value), ttl);
  }

  async delete(key: string): Promise<void> {
    await this.commands.del([this.k(key)]);
  }

  async has(key: string): Promise<boolean> {
    return (await this.commands.get(this.k(key))) !== null;
  }

  /** Full Redis keys (namespace included) under `prefix`, deduplicated. */
  private async rawKeys(prefix: string): Promise<string[]> {
    const seen = new Set<string>();
    for await (const batch of this.commands.scan(escapeGlob(this.k(prefix)) + '*')) {
      for (const key of batch) seen.add(key);
    }
    return [...seen];
  }

  async keys(prefix = ''): Promise<string[]> {
    const n = this.ns.length;
    return (await this.rawKeys(prefix)).map((k) => k.slice(n));
  }

  async clear(prefix = ''): Promise<void> {
    // Delete page by page while scanning (safe in Redis) to keep memory flat.
    let batch: string[] = [];
    for await (const page of this.commands.scan(escapeGlob(this.k(prefix)) + '*')) {
      batch.push(...page);
      if (batch.length >= DEL_BATCH) {
        await this.commands.del([...new Set(batch)]);
        batch = [];
      }
    }
    if (batch.length) await this.commands.del([...new Set(batch)]);
  }

  /** One SCAN pass plus a single `MGET` (falls back to parallel `GET`s if the client has no MGET). */
  async entries(prefix: string): Promise<Array<[string, unknown]>> {
    const raw = await this.rawKeys(prefix);
    if (!raw.length) return [];
    const values = this.commands.mget
      ? await this.commands.mget(raw)
      : await Promise.all(raw.map((k) => this.commands.get(k)));
    const n = this.ns.length;
    const out: Array<[string, unknown]> = [];
    raw.forEach((k, i) => {
      // A key can expire between SCAN and MGET — skip it.
      if (values[i] !== null && values[i] !== undefined) out.push([k.slice(n), decode(values[i])]);
    });
    return out;
  }

  /** Close the client (unless `closeClient: false`). Safe to call more than once. */
  async close(): Promise<void> {
    if (this.closeClient) await this.commands.close?.();
  }
}

/**
 * Parse stored text back into a value. Tolerates values a client already deserialized
 * and plain (non-JSON) strings written by other code.
 */
function decode(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
