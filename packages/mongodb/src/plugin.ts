import { useService, type TeactPlugin } from '@teactjs/core';
import { definePlugin } from '@teactjs/plugin-sdk';
import type { MongoClientLike, MongoDbLike } from './types';

/** Options for {@link mongoPlugin}. Pass a `client` (plus an optional `dbName`) or a `db`. */
export interface MongoPluginOptions {
  /** A connected `MongoClient`. */
  client?: MongoClientLike;
  /** Database to expose when `client` is given (defaults to the one in the connection string). */
  dbName?: string;
  /** A `Db` to expose directly. */
  db?: MongoDbLike;
  /**
   * Close `client` when the bot stops. Has no effect without a `client`.
   * @default true
   */
  closeOnStop?: boolean;
}

/** Service key the `Db` is registered under (`useService('mongo')`). */
export const MONGO_SERVICE = 'mongo';
/** Service key the `MongoClient` is registered under, when one was given. */
export const MONGO_CLIENT_SERVICE = 'mongoClient';

/**
 * Expose a MongoDB database to every component through {@link useMongo}, and close the
 * client when the bot stops.
 *
 * @example
 * const client = await new MongoClient(process.env.MONGO_URL!).connect();
 * createBot({ plugins: [mongoPlugin({ client, dbName: 'mybot' })], ... });
 *
 * function Profile() {
 *   const db = useMongo<Db>();
 *   // db.collection('users').findOne(...) in a handler or effect
 * }
 */
export function mongoPlugin(opts: MongoPluginOptions): TeactPlugin {
  return definePlugin<MongoPluginOptions>({
    name: 'mongodb',
    setup(ctx) {
      const { client, db, dbName, closeOnStop = true } = ctx.config;
      const database = db ?? client?.db(dbName);
      if (!database) throw new Error('[teact/mongodb] mongoPlugin needs a `client` or a `db`.');
      ctx.provideService(MONGO_SERVICE, database);
      if (client) {
        ctx.provideService(MONGO_CLIENT_SERVICE, client);
        if (closeOnStop) ctx.onStop(() => client.close());
      }
    },
  })(opts);
}

/**
 * The `Db` registered by {@link mongoPlugin}.
 *
 * @example
 * import type { Db } from 'mongodb';
 * const db = useMongo<Db>();
 */
export function useMongo<D = MongoDbLike>(): D {
  return useService<D>(MONGO_SERVICE);
}
