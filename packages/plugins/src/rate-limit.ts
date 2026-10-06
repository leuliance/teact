import { halt, type BotContext, type TeactPlugin } from '@teactjs/core';
import type { AnyStorageDriver } from '@teactjs/storage';
import { AdapterRef, KeyedMutex, createKV, type Reply } from './utils';

/** Options for {@link rateLimit}. */
export interface RateLimitOptions {
  /** Window length in **milliseconds**. Default `1000`. */
  window?: number;
  /** Max updates allowed per key within one window. Default `3`. */
  limit?: number;
  /**
   * What to count against:
   * - `'user'` (default) — per user, across all chats,
   * - `'chat'` — per chat (a whole group shares one budget),
   * - a function returning a custom key; return `null`/`undefined` to skip limiting
   *   for that update (e.g. admins).
   */
  key?: 'user' | 'chat' | ((ctx: BotContext) => string | null | undefined);
  /**
   * `'sliding'` (default) counts updates in the last `window` ms — smooth, no bursts at
   * window boundaries. `'fixed'` uses aligned buckets (`floor(now / window)`) — cheaper
   * (one counter per key) and easier to reason about.
   */
  strategy?: 'sliding' | 'fixed';
  /**
   * Sent when a key goes over the limit — at most once per window, so the bot never
   * floods the flooder. Text, an `OutputNode`, or `(ctx, reply) => ...`. Omit to drop
   * silently.
   */
  onLimited?: Reply;
  /**
   * Storage driver for the counters (any `@teactjs/storage` driver, e.g. Redis) so
   * limits are shared across bot instances. Defaults to in-process memory.
   */
  storage?: AnyStorageDriver;
  /** Key prefix in `storage`. Default `'teact:ratelimit:'`. */
  prefix?: string;
}

interface SlidingRecord { hits: number[]; notified?: number }
interface FixedRecord { count: number; notified?: boolean }

/**
 * Flood protection. Counts updates (messages **and** button presses) per user/chat and
 * blocks the ones over `limit` per `window` — the component is not rendered and nothing
 * is sent, except an optional `onLimited` notice (at most once per window).
 *
 * Register it early in `plugins` so blocked updates skip the rest of the pipeline.
 *
 * @example
 * rateLimit({ window: 2000, limit: 3, onLimited: '⏳ Slow down a bit!' })
 *
 * // Shared across instances (horizontal scaling):
 * import { RedisDriver } from '@teactjs/redis';
 * rateLimit({ window: 60_000, limit: 20, key: 'chat', storage: new RedisDriver({ url }) })
 */
export function rateLimit(options: RateLimitOptions = {}): TeactPlugin {
  const windowMs = options.window ?? 1000;
  const limit = options.limit ?? 3;
  const strategy = options.strategy ?? 'sliding';
  const keyOpt = options.key ?? 'user';
  if (!(windowMs > 0)) throw new Error('[teact-rate-limit] `window` must be > 0 ms');
  if (!(limit >= 1)) throw new Error('[teact-rate-limit] `limit` must be >= 1');

  const kv = createKV(options.storage, options.prefix ?? 'teact:ratelimit:');
  const lock = new KeyedMutex();
  const ref = new AdapterRef();

  const keyOf = (ctx: BotContext): string | null | undefined => {
    if (keyOpt === 'user') return `u:${ctx.platform}:${ctx.userId}`;
    if (keyOpt === 'chat') return `c:${ctx.platform}:${ctx.chatId}`;
    const k = keyOpt(ctx);
    return k == null ? k : `k:${k}`;
  };

  /** Returns `null` if allowed, or `{ notify }` if limited. */
  const hit = (key: string): Promise<{ notify: boolean } | null> =>
    lock.run(key, async () => {
      const now = Date.now();
      if (strategy === 'fixed') {
        const bucket = Math.floor(now / windowMs);
        const k = `${key}:${bucket}`;
        const rec = (await kv.get<FixedRecord>(k)) ?? { count: 0 };
        const ttl = (bucket + 1) * windowMs - now;
        if (rec.count < limit) {
          rec.count++;
          await kv.set(k, rec, ttl);
          return null;
        }
        if (rec.notified) return { notify: false };
        rec.notified = true;
        await kv.set(k, rec, ttl);
        return { notify: true };
      }
      const rec = (await kv.get<SlidingRecord>(key)) ?? { hits: [] };
      rec.hits = rec.hits.filter((t) => t > now - windowMs);
      if (rec.hits.length < limit) {
        rec.hits.push(now);
        await kv.set(key, rec, windowMs);
        return null;
      }
      if (rec.notified != null && rec.notified > now - windowMs) return { notify: false };
      rec.notified = now;
      await kv.set(key, rec, windowMs);
      return { notify: true };
    });

  return {
    name: 'teact-rate-limit',
    onStart(adapter) { ref.adapter = adapter; },
    async middleware(ctx, next) {
      const key = keyOf(ctx);
      if (key == null) return next();
      const limited = await hit(key);
      if (!limited) return next();
      halt(ctx);
      if (limited.notify) await ref.send(ctx, options.onLimited, 'teact-rate-limit');
    },
  };
}
