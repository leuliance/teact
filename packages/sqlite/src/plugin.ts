import type { SessionStore, TeactPlugin } from '@teactjs/core';
import { useService } from '@teactjs/core';
import { createSessionStore } from '@teactjs/storage';
import type { CreateSessionStoreOptions } from '@teactjs/storage';
import { definePlugin } from '@teactjs/plugin-sdk';
import { SqliteDriver } from './driver';
import type { SqliteDatabase, SqliteDriverOptions } from './driver';

/** Service key under which {@link sqlitePlugin} registers its driver. */
export const SQLITE_SERVICE = 'sqlite';

/**
 * Build a durable `SessionStore` backed by SQLite, for `createBot({ session: { store } })`.
 * Accepts an existing {@link SqliteDriver}, a database handle, or driver options.
 * Sessions honour `ttl` (ms) — expired sessions read as empty.
 *
 * @example
 * createBot({ session: { store: sqliteSessionStore({ path: './data/bot.db' }, { ttl: 7 * 864e5 }) } });
 */
export function sqliteSessionStore(
  source: SqliteDriver | SqliteDriverOptions | SqliteDatabase,
  opts: CreateSessionStoreOptions = {},
): SessionStore {
  const driver = source instanceof SqliteDriver ? source : new SqliteDriver(source);
  // The async view honours ttl; createSessionStore ignores ttl for sync drivers.
  return createSessionStore(driver.asAsync(), opts);
}

/** Options for {@link sqlitePlugin}: driver options, or a ready-made `driver`. */
export interface SqlitePluginOptions extends SqliteDriverOptions {
  /** Share a driver you also pass to `storagePlugin` / `sqliteSessionStore`. */
  driver?: SqliteDriver;
  /**
   * Close the database when the bot stops. Defaults to `true` when the plugin opened it
   * from `path`, `false` for a `db` or `driver` you passed in.
   */
  closeOnStop?: boolean;
}

/**
 * Register a {@link SqliteDriver} as the `'sqlite'` service so components can query the
 * database with {@link useSqlite}. Combine with `storagePlugin` for `useStorage`.
 *
 * @example
 * const sqlite = new SqliteDriver({ path: './data/bot.db' });
 * createBot({ plugins: [storagePlugin({ driver: sqlite }), sqlitePlugin({ driver: sqlite })] });
 *
 * function Stats() {
 *   const { db } = useSqlite();
 *   const row = db.prepare('SELECT count(*) AS n FROM teact_storage').get() as { n: number };
 *   return <Message text={`${row.n} keys`} />;
 * }
 */
export function sqlitePlugin(opts: SqlitePluginOptions): TeactPlugin {
  return definePlugin<SqlitePluginOptions>({
    name: 'teact-sqlite',
    setup(ctx) {
      const { driver: given, closeOnStop, ...driverOpts } = ctx.config;
      const driver = given ?? new SqliteDriver(driverOpts);
      ctx.provideService(SQLITE_SERVICE, driver);
      const shouldClose = closeOnStop ?? (!given && !driverOpts.db);
      if (shouldClose) ctx.onStop(() => driver.close());
    },
  })(opts);
}

/** The {@link SqliteDriver} registered by {@link sqlitePlugin}. `driver.db` is the raw handle. */
export function useSqlite(): SqliteDriver {
  return useService<SqliteDriver>(SQLITE_SERVICE);
}
