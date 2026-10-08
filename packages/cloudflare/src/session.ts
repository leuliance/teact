import type { SessionStore } from '@teactjs/core';
import { createSessionStore, type CreateSessionStoreOptions } from '@teactjs/storage';
import { KVDriver, type KVDriverOptions } from './kv';
import { D1Driver, type D1DriverOptions } from './d1';
import type { D1DatabaseLike, KVNamespaceLike, Lazy } from './types';

/** Options for {@link kvSessionStore}. */
export interface KVSessionStoreOptions extends KVDriverOptions, CreateSessionStoreOptions {}

/** Options for {@link d1SessionStore}. */
export interface D1SessionStoreOptions extends D1DriverOptions, CreateSessionStoreOptions {}

/**
 * A `SessionStore` backed by Workers KV. `ttl` is in milliseconds and rounded up to KV's
 * 60-second minimum.
 *
 * KV is eventually consistent. A user whose consecutive updates land in different
 * Cloudflare locations may briefly see an older session. Use {@link d1SessionStore}
 * when sessions drive multi-step flows.
 *
 * @example
 * import { env } from 'cloudflare:workers';
 * createBot({ session: { store: kvSessionStore(() => env.SESSIONS) }, ... });
 */
export function kvSessionStore(kv: Lazy<KVNamespaceLike>, opts: KVSessionStoreOptions = {}): SessionStore {
  const { prefix, ttl, ...driverOpts } = opts;
  return createSessionStore(new KVDriver(kv, driverOpts), { prefix, ttl });
}

/**
 * A strongly consistent `SessionStore` backed by D1.
 *
 * @example
 * import { env } from 'cloudflare:workers';
 * createBot({ session: { store: d1SessionStore(() => env.DB, { ttl: 7 * 24 * 3600_000 }) }, ... });
 */
export function d1SessionStore(db: Lazy<D1DatabaseLike>, opts: D1SessionStoreOptions = {}): SessionStore {
  const { prefix, ttl, ...driverOpts } = opts;
  return createSessionStore(new D1Driver(db, driverOpts), { prefix, ttl });
}
