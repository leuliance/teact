// Structural shapes of the official `mongodb` driver's objects — only what Teact calls.
// Declared loosely (`any` filters/options) so real `Collection`/`Db`/`MongoClient`
// instances are assignable without the `mongodb` package being installed.

/** A stored entry: `{ _id: key, value, expiresAt? }`. */
export interface MongoStorageDoc {
  _id: string;
  value: unknown;
  /** Absolute expiry. Pair with a TTL index (see `MongoDriver.ensureIndexes`). */
  expiresAt?: Date | null;
}

/** A cursor returned by `collection.find()`. */
export interface MongoCursorLike<T = any> {
  toArray(): Promise<T[]>;
}

/** The subset of a `mongodb` `Collection` Teact uses. */
export interface MongoCollectionLike {
  findOne(filter: any, options?: any): Promise<any>;
  find(filter: any, options?: any): MongoCursorLike;
  updateOne(filter: any, update: any, options?: any): Promise<unknown>;
  /**
   * Used by `MongoDriver.incr`. Resolves the document (driver v6+) or a
   * `{ value, ok }` result (v5); both are handled.
   */
  findOneAndUpdate?(filter: any, update: any, options?: any): Promise<any>;
  deleteOne(filter: any, options?: any): Promise<unknown>;
  deleteMany(filter: any, options?: any): Promise<unknown>;
  createIndex(spec: any, options?: any): Promise<unknown>;
}

/** The subset of a `mongodb` `Db` Teact uses. */
export interface MongoDbLike {
  collection(name: string, options?: any): MongoCollectionLike;
}

/** The subset of a `mongodb` `MongoClient` Teact uses. */
export interface MongoClientLike {
  db(name?: string, options?: any): MongoDbLike;
  close(force?: boolean): Promise<void>;
}
