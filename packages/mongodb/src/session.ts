import type { SessionStore } from '@teactjs/core';
import { createSessionStore } from '@teactjs/storage';
import { MongoDriver, type MongoDriverOptions } from './driver';

/** Options for {@link mongoSessionStore}. */
export interface MongoSessionStoreOptions extends MongoDriverOptions {
  /** Key prefix for session documents (`_id`). @default 'session:' */
  prefix?: string;
  /** Session lifetime in milliseconds, stored as `expiresAt` and refreshed on every write. */
  ttl?: number;
}

/**
 * A durable `SessionStore` for `createBot({ session: { store } })`, backed by MongoDB.
 * With `ttl`, call `new MongoDriver(...).ensureIndexes()` once so Mongo deletes expired sessions.
 *
 * @example
 * createBot({ session: { store: mongoSessionStore({ db: client.db('mybot'), collectionName: 'sessions' }) }, ... });
 */
export function mongoSessionStore(opts: MongoSessionStoreOptions): SessionStore {
  const { prefix, ttl, ...driverOpts } = opts;
  return createSessionStore(new MongoDriver(driverOpts), { prefix, ttl });
}
