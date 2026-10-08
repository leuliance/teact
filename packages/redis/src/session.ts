import type { SessionStore } from '@teactjs/core';
import { createSessionStore } from '@teactjs/storage';
import { RedisDriver, type RedisDriverOptions } from './driver';

/** Options for {@link redisSessionStore}. */
export interface RedisSessionStoreOptions extends RedisDriverOptions {
  /** Key prefix for sessions (after `namespace`). @default 'session:' */
  prefix?: string;
  /** Session lifetime in milliseconds — refreshed on every write (`SET … PX`). */
  ttl?: number;
}

/**
 * A durable `SessionStore` for `createBot({ session: { store } })`, backed by Redis.
 *
 * @example
 * createBot({
 *   session: { store: redisSessionStore({ client: redis, ttl: 7 * 24 * 3600_000 }) },
 *   ...
 * });
 */
export function redisSessionStore(opts: RedisSessionStoreOptions): SessionStore {
  const { prefix, ttl, ...driverOpts } = opts;
  return createSessionStore(new RedisDriver(driverOpts), { prefix, ttl });
}
