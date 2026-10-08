import type { SessionStore, TeactPlugin } from '@teactjs/core';
import { useService } from '@teactjs/core';
import { createSessionStore } from '@teactjs/storage';
import type { CreateSessionStoreOptions } from '@teactjs/storage';
import { definePlugin } from '@teactjs/plugin-sdk';
import { PostgresDriver } from './driver';
import { closeClient } from './client';
import type { PostgresDriverOptions } from './driver';

/** Service key under which {@link postgresPlugin} registers its driver. */
export const POSTGRES_SERVICE = 'postgres';

/**
 * Build a durable `SessionStore` backed by Postgres, for `createBot({ session: { store } })`.
 * Accepts a {@link PostgresDriver} or driver options. Each session write is awaited before the
 * update finishes, so it is safe on serverless. `ttl` (ms) expires idle sessions.
 *
 * @example
 * createBot({ session: { store: postgresSessionStore({ client: pool }, { ttl: 30 * 864e5 }) } });
 */
export function postgresSessionStore(
  source: PostgresDriver | PostgresDriverOptions,
  opts: CreateSessionStoreOptions = {},
): SessionStore {
  const driver = source instanceof PostgresDriver ? source : new PostgresDriver(source);
  return createSessionStore(driver, opts);
}

/** Options for {@link postgresPlugin}: driver options, or a ready-made `driver`. */
export interface PostgresPluginOptions extends Partial<PostgresDriverOptions> {
  /** Share a driver you also pass to `storagePlugin` / `postgresSessionStore`. */
  driver?: PostgresDriver;
  /** End the client when the bot stops. @default false (you own the pool) */
  closeOnStop?: boolean;
}

/**
 * Register a {@link PostgresDriver} as the `'postgres'` service so components can run
 * queries with {@link usePostgres}. Combine with `storagePlugin` for `useStorage`.
 *
 * @example
 * const pg = new PostgresDriver({ client: pool });
 * createBot({ plugins: [storagePlugin({ driver: pg }), postgresPlugin({ driver: pg })] });
 *
 * function Top() {
 *   const pg = usePostgres();
 *   const { data } = useQuery('top', () => pg.query('SELECT name FROM scores ORDER BY points DESC LIMIT 10'));
 *   ...
 * }
 */
export function postgresPlugin(opts: PostgresPluginOptions): TeactPlugin {
  return definePlugin<PostgresPluginOptions>({
    name: 'teact-postgres',
    setup(ctx) {
      const { driver: given, closeOnStop, ...driverOpts } = ctx.config;
      if (!given && !driverOpts.client) throw new Error('[teact/postgres] postgresPlugin needs { client } or { driver }.');
      const driver = given ?? new PostgresDriver(driverOpts as PostgresDriverOptions);
      ctx.provideService(POSTGRES_SERVICE, driver);
      if (closeOnStop) {
        ctx.onStop(() => closeClient(driver.client));
      }
    },
  })(opts);
}

/** The {@link PostgresDriver} registered by {@link postgresPlugin}; `query()` runs raw SQL. */
export function usePostgres(): PostgresDriver {
  return useService<PostgresDriver>(POSTGRES_SERVICE);
}
