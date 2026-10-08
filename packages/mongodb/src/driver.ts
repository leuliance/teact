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
 * Normalize `SetOptions.ttl`: a positive finite number of ms, or `undefined` for "never
 * expires" (`0`, negative, `NaN`, `Infinity` or omitted — so `new Date()` never gets an
 * invalid time).
 */
function normalizeTtl(ttl: number | undefined): number | undefined {
  return typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : undefined;
}

/**
 * Write options: the official driver serializes `undefined` object members as `null` by
 * default; `ignoreUndefined` drops them like `JSON.stringify` (and every other driver) does.
 */
const WRITE_OPTS = { upsert: true, ignoreUndefined: true } as const;

/** Mongo duplicate-key error (a concurrent upsert inserted the same `_id` first). */
const isDuplicateKey = (err: unknown) => (err as { code?: unknown })?.code === 11000;

/** `findOneAndUpdate` resolves the document (v6+) or `{ value, ok, … }` (v5). */
function modifiedDoc(res: any): MongoStorageDoc | null {
  if (!res) return null;
  return '_id' in res ? res : (res.value ?? null);
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
 * - **BSON, not JSON**: values keep their BSON types, so a stored `Date` comes back as a
 *   `Date` (other drivers JSON-encode it and return an ISO string). `undefined` object
 *   members are dropped (`ignoreUndefined`), as with JSON.
 * - **`incr`** is atomic (`$inc`); an expired document counts as missing.
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
  /**
   * Atomically add `by` (default 1) to the number at `key` (missing or expired → 0) and
   * resolve the new value; `opts.ttl` applies only when the increment creates the key.
   * Defined when the collection has `findOneAndUpdate` (every real `Collection` does).
   */
  readonly incr?: (key: string, by?: number, opts?: SetOptions) => Promise<number>;

  constructor(opts: MongoDriverOptions) {
    const name = opts.collectionName ?? DEFAULT_COLLECTION;
    if (opts.collection) this.collection = opts.collection;
    else if (opts.db) this.collection = opts.db.collection(name);
    else if (opts.client) this.collection = opts.client.db(opts.dbName).collection(name);
    else throw new Error('[teact/mongodb] MongoDriver needs a `collection`, `db` or `client`.');
    this.client = opts.client;
    this.closeClient = opts.closeClient ?? false;
    if (typeof this.collection.findOneAndUpdate === 'function') this.incr = (k, by, o) => this.increment(k, by, o);
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
    await this.collection.updateOne({ _id: key }, this.replaceUpdate(value, normalizeTtl(opts?.ttl)), WRITE_OPTS);
  }

  /** Update document that replaces the value and sets (or clears) the expiry. */
  private replaceUpdate(value: unknown, ttl: number | undefined): Record<string, unknown> {
    return ttl !== undefined
      ? { $set: { value, expiresAt: new Date(Date.now() + ttl) } }
      : { $set: { value }, $unset: { expiresAt: '' } };
  }

  /**
   * Lock-free increment, each step a single atomic `findOneAndUpdate`:
   * 1. `$inc` a live document (keeps its expiry);
   * 2. otherwise replace an expired document, or insert a new one, with `value: by` and the
   *    ttl (upsert);
   * 3. if a concurrent call inserted the key between 1 and 2 (duplicate `_id`), retry.
   * Every increment is applied exactly once. Rejects when the value is not a number.
   */
  private async increment(key: string, by = 1, opts?: SetOptions): Promise<number> {
    if (!Number.isFinite(by)) throw new TypeError(`[teact/mongodb] incr: \`by\` must be a finite number, got ${by}`);
    const ttl = normalizeTtl(opts?.ttl);
    const after = { returnDocument: 'after', ignoreUndefined: true } as const;
    for (let attempt = 0; ; attempt++) {
      const now = new Date();
      const live = await this.collection.findOneAndUpdate!(
        { _id: key, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        { $inc: { value: by } },
        after,
      );
      const incremented = modifiedDoc(live);
      if (incremented) return incremented.value as number;
      try {
        const created = await this.collection.findOneAndUpdate!(
          { _id: key, expiresAt: { $lte: now } },
          this.replaceUpdate(by, ttl),
          { ...after, upsert: true },
        );
        return (modifiedDoc(created)?.value as number | undefined) ?? by;
      } catch (err) {
        if (!isDuplicateKey(err) || attempt >= 10) throw err;
      }
    }
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
