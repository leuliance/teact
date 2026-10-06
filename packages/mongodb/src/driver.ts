import type { AsyncStorageDriver, SetOptions } from '@teactjs/storage';
import type { MongoClientLike, MongoCollectionLike, MongoDbLike, MongoStorageDoc } from './types';

/** Default collection name when the driver is given a `db`/`client`. */
export const DEFAULT_COLLECTION = 'teact_storage';

/** Options for {@link MongoDriver}. Pass exactly one of `collection`, `db` or `client`. */
export interface MongoDriverOptions {
  /** The collection to store entries in. */
  collection?: MongoCollectionLike;
  /** A database; the driver uses `db.collection(collectionName)`. */
  db?: MongoDbLike;
  /** A connected `MongoClient`; the driver uses `client.db(dbName).collection(collectionName)`. */
  client?: MongoClientLike;
  /** Database name when `client` is given (defaults to the one in the connection string). */
  dbName?: string;
  /** Collection name when `db`/`client` is given. @default 'teact_storage' */
  collectionName?: string;
  /**
   * Close `client` when the driver is closed (the storage plugin closes its driver in
   * `onStop`). Only applies when a `client` was passed.
   * @default false
   */
  closeClient?: boolean;
}

/** Escape RegExp metacharacters so `s` matches literally. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * {@link AsyncStorageDriver} backed by a MongoDB collection.
 *
 * Each entry is one document, `{ _id: key, value, expiresAt? }`. `value` is stored as
 * native BSON, so you can query it with ordinary Mongo tools.
 *
 * - **Prefix queries** use an anchored, escaped `^prefix` regex on `_id`, which can use
 *   the `_id` index.
 * - **Expiry**: `set(k, v, { ttl })` writes `expiresAt`. Expired documents are filtered
 *   out on read immediately. To have Mongo delete them, create a TTL index once with
 *   {@link MongoDriver.ensureIndexes} (`{ expiresAt: 1 }`, `expireAfterSeconds: 0`).
 *   Mongo's TTL monitor runs about once a minute.
 *
 * @example
 * import { MongoClient } from 'mongodb';
 * const client = await new MongoClient(process.env.MONGO_URL!).connect();
 * const driver = new MongoDriver({ db: client.db('mybot') });
 * await driver.ensureIndexes();
 * createBot({ plugins: [storagePlugin({ driver })], ... });
 */
export class MongoDriver implements AsyncStorageDriver {
  readonly async = true as const;
  /** The collection entries live in. */
  readonly collection: MongoCollectionLike;
  private readonly client?: MongoClientLike;
  private readonly closeClient: boolean;

  constructor(opts: MongoDriverOptions) {
    const name = opts.collectionName ?? DEFAULT_COLLECTION;
    if (opts.collection) this.collection = opts.collection;
    else if (opts.db) this.collection = opts.db.collection(name);
    else if (opts.client) this.collection = opts.client.db(opts.dbName).collection(name);
    else throw new Error('[teact/mongodb] MongoDriver needs a `collection`, `db` or `client`.');
    this.client = opts.client;
    this.closeClient = opts.closeClient ?? false;
  }

  /**
   * Create the TTL index on `expiresAt` (`expireAfterSeconds: 0`) so Mongo deletes
   * expired entries. Call it once at startup or in a migration. It is idempotent.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'teact_expiresAt_ttl' });
  }

  /** Filter matching keys under `prefix` that haven't expired. */
  private liveFilter(prefix: string): Record<string, unknown> {
    const notExpired = { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    return prefix ? { _id: { $regex: '^' + escapeRegex(prefix) }, ...notExpired } : notExpired;
  }

  private async findLive(key: string, projection?: Record<string, 1>): Promise<MongoStorageDoc | null> {
    const doc = (await this.collection.findOne({ _id: key }, projection ? { projection } : undefined)) as MongoStorageDoc | null;
    if (!doc || isExpired(doc)) return null;
    return doc;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.findLive(key))?.value as T | undefined;
  }

  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    if (value === undefined) return this.delete(key);
    const update =
      opts?.ttl && opts.ttl > 0
        ? { $set: { value, expiresAt: new Date(Date.now() + opts.ttl) } }
        : { $set: { value }, $unset: { expiresAt: '' } };
    await this.collection.updateOne({ _id: key }, update, { upsert: true });
  }

  async delete(key: string): Promise<void> {
    await this.collection.deleteOne({ _id: key });
  }

  async has(key: string): Promise<boolean> {
    return !!(await this.findLive(key, { _id: 1, expiresAt: 1 }));
  }

  async keys(prefix = ''): Promise<string[]> {
    const docs = await this.collection.find(this.liveFilter(prefix), { projection: { _id: 1 } }).toArray();
    return docs.map((d: MongoStorageDoc) => d._id);
  }

  async clear(prefix = ''): Promise<void> {
    await this.collection.deleteMany(prefix ? { _id: { $regex: '^' + escapeRegex(prefix) } } : {});
  }

  /** Every live entry under `prefix`, in a single query. */
  async entries(prefix: string): Promise<Array<[string, unknown]>> {
    const docs = await this.collection.find(this.liveFilter(prefix), { projection: { _id: 1, value: 1 } }).toArray();
    return docs.map((d: MongoStorageDoc) => [d._id, d.value] as [string, unknown]);
  }

  /** Close the client if one was passed with `closeClient: true`. */
  async close(): Promise<void> {
    if (this.closeClient) await this.client?.close();
  }
}

function isExpired(doc: MongoStorageDoc): boolean {
  return doc.expiresAt != null && new Date(doc.expiresAt).getTime() <= Date.now();
}
