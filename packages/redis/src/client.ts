/**
 * A tiny, normalized view of a Redis client.
 *
 * Redis client libraries disagree on almost everything that matters to a key/value store
 * — how to pass an expiry to `SET`, how `SCAN` takes its options and what it returns,
 * whether `GET` hands back the raw string or a deserialized value. {@link RedisDriver}
 * only ever talks to this interface; the `from*` helpers below adapt each popular client
 * to it, and {@link toRedisCommands} picks the right one automatically.
 *
 * Implement it yourself to plug in any other client (a cluster wrapper, a mock, …).
 */
export interface RedisCommands {
  /** Raw stored text for `key`, or `null` when the key does not exist. */
  get(key: string): Promise<string | null>;
  /** Raw stored text for each key (`null` for missing keys), in one round trip. */
  mget?(keys: string[]): Promise<Array<string | null>>;
  /** Store `value`; when `ttlMs` is given the key expires after that many milliseconds (`SET … PX`). */
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Delete the given keys (`DEL k1 k2 …`). Called with at least one key. */
  del(keys: string[]): Promise<void>;
  /**
   * Iterate keys matching a glob `pattern` with `SCAN … MATCH pattern` (never `KEYS`).
   * Yields one batch per SCAN page; batches may contain duplicates, the driver dedupes.
   */
  scan(pattern: string): AsyncIterable<string[]>;
  /** Close the underlying connection, if the client has one. */
  close?(): Promise<void>;
}

/** How many keys to ask for per SCAN page (`COUNT` hint). */
const SCAN_COUNT = 250;

// ── Structural shapes of the supported clients ─────────────────────────────────────────
// Only the members Teact calls are declared, so none of the libraries has to be installed
// to compile against them. Parameters are intentionally loose (`any`) where the real
// libraries use heavily overloaded signatures, so real clients stay assignable.

/** The subset of an [ioredis](https://github.com/redis/ioredis) `Redis`/`Cluster` client Teact uses. */
export interface IoredisLike {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string | number, ...args: any[]): Promise<[string, string[]]>;
  quit?(): Promise<unknown>;
}

/** The subset of a [node-redis](https://github.com/redis/node-redis) v4/v5 client Teact uses. */
export interface NodeRedisLike {
  get(key: string): Promise<string | null | unknown>;
  mGet(keys: string[]): Promise<Array<string | null | unknown>>;
  set(key: string, value: string, options?: any): Promise<unknown>;
  del(keys: string | string[]): Promise<number>;
  scan(cursor: any, options?: any): Promise<{ cursor: string | number; keys: string[] }>;
  quit?(): Promise<unknown>;
  close?(): Promise<unknown>;
}

/** The subset of Bun's built-in `RedisClient` (`Bun.redis` / `new RedisClient(url)`) Teact uses. */
export interface BunRedisLike {
  get(key: string): Promise<string | null>;
  mget?(...keys: string[]): Promise<Array<string | null>>;
  del(...keys: string[]): Promise<number>;
  /** Raw command escape hatch — used for `SET … PX` and `SCAN`, which every Bun version supports this way. */
  send(command: string, args: string[]): Promise<any>;
  close?(): void;
}

/**
 * The subset of an [@upstash/redis](https://github.com/upstash/redis-js) client Teact uses
 * (HTTP/REST — works on Cloudflare Workers, Vercel Edge, Deno Deploy, …).
 *
 * Upstash deserializes JSON values automatically by default; the adapter accounts for that.
 */
export interface UpstashLike {
  get(key: string): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  set(key: string, value: string, opts?: any): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  scan(cursor: string | number, opts?: any): Promise<[string | number, string[]]>;
}

// ── Adapters ───────────────────────────────────────────────────────────────────────────

/** Remember which raw clients were already closed, so a client shared by the driver and `redisPlugin` is closed once. */
const closed = new WeakSet<object>();

async function closeOnce(client: object, fn: () => unknown): Promise<void> {
  if (closed.has(client)) return;
  closed.add(client);
  await fn();
}

async function* scanLoop(
  page: (cursor: string) => Promise<[string | number, string[]]>,
): AsyncIterable<string[]> {
  let cursor = '0';
  do {
    const [next, keys] = await page(cursor);
    cursor = String(next);
    if (keys.length) yield keys;
  } while (cursor !== '0');
}

/**
 * Adapt an [ioredis](https://github.com/redis/ioredis) client.
 *
 * @example
 * import Redis from 'ioredis';
 * new RedisDriver({ client: fromIoredis(new Redis(process.env.REDIS_URL!)) });
 */
export function fromIoredis(client: IoredisLike): RedisCommands {
  return markNormalized({
    get: (key) => client.get(key),
    mget: (keys) => client.mget(...keys),
    async set(key, value, ttlMs) {
      if (ttlMs) await client.set(key, value, 'PX', ttlMs);
      else await client.set(key, value);
    },
    async del(keys) { await client.del(...keys); },
    scan: (pattern) => scanLoop((c) => client.scan(c, 'MATCH', pattern, 'COUNT', SCAN_COUNT)),
    close: () => closeOnce(client, () => client.quit?.()),
  });
}

/**
 * Adapt a [node-redis](https://github.com/redis/node-redis) v4+ client (`createClient()`).
 * Remember to `await client.connect()` before the first update.
 *
 * @example
 * import { createClient } from 'redis';
 * const client = await createClient({ url: process.env.REDIS_URL }).connect();
 * new RedisDriver({ client: fromNodeRedis(client) });
 */
export function fromNodeRedis(client: NodeRedisLike): RedisCommands {
  // RESP3 / type-mapping setups can hand back Buffers; normalize to strings.
  const str = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : String(v));
  return markNormalized({
    get: async (key) => str(await client.get(key)),
    mget: async (keys) => (await client.mGet(keys)).map(str),
    async set(key, value, ttlMs) {
      if (ttlMs) await client.set(key, value, { PX: ttlMs });
      else await client.set(key, value);
    },
    async del(keys) { await client.del(keys); },
    // v4 returns a numeric cursor, v5 a string one; both accept a string cursor argument.
    scan: (pattern) =>
      scanLoop(async (c) => {
        const r = await client.scan(c, { MATCH: pattern, COUNT: SCAN_COUNT });
        return [r.cursor, r.keys];
      }),
    // v5 prefers close(); v4 only has quit().
    close: () => closeOnce(client, () => (client.close ? client.close() : client.quit?.())),
  });
}

/**
 * Adapt Bun's built-in Redis client (`import { redis, RedisClient } from 'bun'`).
 *
 * @example
 * import { RedisClient } from 'bun';
 * new RedisDriver({ client: fromBunRedis(new RedisClient(process.env.REDIS_URL)) });
 */
export function fromBunRedis(client: BunRedisLike): RedisCommands {
  return markNormalized({
    get: (key) => client.get(key),
    mget: (keys) => (client.mget ? client.mget(...keys) : client.send('MGET', keys)),
    async set(key, value, ttlMs) {
      await client.send('SET', ttlMs ? [key, value, 'PX', String(Math.ceil(ttlMs))] : [key, value]);
    },
    async del(keys) { await client.del(...keys); },
    scan: (pattern) => scanLoop((c) => client.send('SCAN', [c, 'MATCH', pattern, 'COUNT', String(SCAN_COUNT)])),
    close: () => closeOnce(client, () => client.close?.()),
  });
}

/** Options for {@link fromUpstash}. */
export interface FromUpstashOptions {
  /**
   * Whether the client was created with automatic deserialization (Upstash's default).
   * Detected from the client when possible; set it explicitly if you constructed the client
   * with `automaticDeserialization: false` and detection fails.
   */
  automaticDeserialization?: boolean;
}

/**
 * Adapt an [@upstash/redis](https://github.com/upstash/redis-js) client. Upstash talks
 * HTTP, so it works where TCP sockets don't — Cloudflare Workers, Vercel Edge, etc.
 *
 * Upstash JSON-parses values on read by default. The adapter re-encodes them so the
 * driver sees exactly what it stored; a stored `null` (indistinguishable from a missing
 * key after deserialization) is disambiguated with `EXISTS`.
 *
 * @example
 * import { Redis } from '@upstash/redis/cloudflare';
 * new RedisDriver({ client: fromUpstash(Redis.fromEnv(env)) });
 */
export function fromUpstash(client: UpstashLike, opts: FromUpstashOptions = {}): RedisCommands {
  const auto =
    opts.automaticDeserialization ??
    (client as { opts?: { automaticDeserialization?: boolean } }).opts?.automaticDeserialization ??
    true;
  const encode = async (key: string, v: unknown): Promise<string | null> => {
    if (v === null || v === undefined) {
      // With auto-deserialization a stored JSON `null` comes back as null too.
      return auto && (await client.exists(key)) ? 'null' : null;
    }
    if (!auto) return typeof v === 'string' ? v : JSON.stringify(v);
    return JSON.stringify(v);
  };
  return markNormalized({
    get: async (key) => encode(key, await client.get(key)),
    mget: async (keys) => {
      const values = await client.mget(...keys);
      return Promise.all(keys.map((k, i) => encode(k, values[i])));
    },
    async set(key, value, ttlMs) {
      if (ttlMs) await client.set(key, value, { px: Math.ceil(ttlMs) });
      else await client.set(key, value);
    },
    async del(keys) { await client.del(...keys); },
    scan: (pattern) => scanLoop((c) => client.scan(c, { match: pattern, count: SCAN_COUNT })),
    // HTTP client — nothing to close.
  });
}

/** Any client {@link RedisDriver} accepts: an already-normalized {@link RedisCommands} or a raw client. */
export type AnyRedisClient = RedisCommands | IoredisLike | NodeRedisLike | BunRedisLike | UpstashLike;

/** Which adapter {@link toRedisCommands} picked (or should pick). */
export type RedisClientKind = 'ioredis' | 'node-redis' | 'bun' | 'upstash';

/**
 * Guess which library a raw client comes from. Returns `undefined` for a
 * {@link RedisCommands} object or an unrecognized client.
 *
 * - node-redis: camel-cased `mGet`
 * - Bun: an instance of `Bun.RedisClient`, or has `send()` without ioredis' `scanStream`
 * - ioredis: has `scanStream()`
 * - Upstash: has an HTTP `client.request()` and `exists()`
 */
export function detectRedisClient(client: unknown): RedisClientKind | undefined {
  if (!client || typeof client !== 'object') return undefined;
  const c = client as Record<string, any>;
  if (isRedisCommands(c)) return undefined;
  if (typeof c.mGet === 'function') return 'node-redis';
  const BunRedis = (globalThis as any).Bun?.RedisClient;
  if (typeof BunRedis === 'function' && c instanceof BunRedis) return 'bun';
  if (typeof c.scanStream === 'function') return 'ioredis';
  if (typeof c.send === 'function' && typeof c.del === 'function') return 'bun';
  if (typeof c.client?.request === 'function' && typeof c.exists === 'function') return 'upstash';
  return undefined;
}

function isRedisCommands(c: Record<PropertyKey, any>): boolean {
  return typeof c.get === 'function' && typeof c.set === 'function' && typeof c.del === 'function'
    && typeof c.scan === 'function' && c[NORMALIZED] === true;
}

/** Duck-typed fallback for unmarked hand-written {@link RedisCommands} implementations. */
function looksLikeCommands(c: Record<string, any>): boolean {
  return !!c && ['get', 'set', 'del', 'scan'].every((m) => typeof c[m] === 'function');
}

/** Marks objects produced by the `from*` adapters (and lets custom implementations opt in). */
export const NORMALIZED: unique symbol = Symbol.for('teact.redis.commands') as any;

const ADAPTERS: Record<RedisClientKind, (c: any) => RedisCommands> = {
  ioredis: fromIoredis,
  'node-redis': fromNodeRedis,
  bun: fromBunRedis,
  upstash: fromUpstash,
};

/**
 * Mark a hand-written {@link RedisCommands} implementation so {@link RedisDriver} uses it
 * as-is instead of trying to auto-detect a client library.
 */
export function markNormalized<T extends RedisCommands>(commands: T): T {
  Object.defineProperty(commands, NORMALIZED, { value: true });
  return commands;
}

/**
 * Normalize any supported client. Objects marked with {@link markNormalized} (everything
 * the `from*` helpers return) pass through; raw clients are auto-detected.
 *
 * @param kind Force a specific adapter instead of auto-detecting.
 * @throws When the client can't be recognized — wrap it with the matching `from*` helper.
 */
export function toRedisCommands(client: AnyRedisClient, kind?: RedisClientKind): RedisCommands {
  if (!kind && isRedisCommands(client as Record<string, any>)) return client as RedisCommands;
  const k = kind ?? detectRedisClient(client);
  if (!k && looksLikeCommands(client as Record<string, any>)) return client as RedisCommands;
  if (!k) {
    throw new Error(
      '[teact/redis] Could not recognize the Redis client. Wrap it with fromIoredis(), fromNodeRedis(), ' +
        'fromBunRedis() or fromUpstash(), or pass a RedisCommands object marked with markNormalized().',
    );
  }
  return ADAPTERS[k](client);
}
