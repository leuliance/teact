import type { SessionData, SessionStore } from '@teactjs/core';
import type { AnyStorageDriver } from './types';
import { isAsyncDriver } from './drivers/cached';

export interface CreateSessionStoreOptions {
  /** Key prefix for session entries. @default 'session:' */
  prefix?: string;
  /** Session lifetime in milliseconds, passed to drivers that support TTL. */
  ttl?: number;
}

/**
 * Turn any storage driver (sync or async) into a `SessionStore` for
 * `createBot({ session: { store } })`. This is how the database packages
 * (`@teactjs/redis`, `@teactjs/postgres`, …) give you durable sessions.
 *
 * @example
 * createBot({ session: { store: createSessionStore(new RedisDriver({ client })) } });
 */
export function createSessionStore(driver: AnyStorageDriver, opts: CreateSessionStoreOptions = {}): SessionStore {
  const prefix = opts.prefix ?? 'session:';
  const ttl = opts.ttl;
  if (isAsyncDriver(driver)) {
    return {
      async get(key) { return (await driver.get<SessionData>(prefix + key)) ?? null; },
      async set(key, data) { await driver.set(prefix + key, data, ttl ? { ttl } : undefined); },
      async delete(key) { await driver.delete(prefix + key); },
    };
  }
  return {
    async get(key) { return driver.get<SessionData>(prefix + key) ?? null; },
    // Sync drivers that accept a third argument (e.g. SqliteDriver) get the ttl too.
    async set(key, data) {
      (driver.set as (k: string, v: unknown, o?: { ttl?: number }) => void)(prefix + key, data, ttl ? { ttl } : undefined);
    },
    async delete(key) { driver.delete(prefix + key); },
  };
}
