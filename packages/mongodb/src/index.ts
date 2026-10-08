// @teactjs/mongodb — MongoDB storage driver, session store and plugin for Teact.

export { MongoDriver, escapeRegex, DEFAULT_COLLECTION } from './driver';
export type { MongoDriverOptions } from './driver';
export { mongoSessionStore } from './session';
export type { MongoSessionStoreOptions } from './session';
export { mongoPlugin, useMongo, MONGO_SERVICE, MONGO_CLIENT_SERVICE } from './plugin';
export type { MongoPluginOptions } from './plugin';
export type {
  MongoStorageDoc,
  MongoCollectionLike,
  MongoCursorLike,
  MongoDbLike,
  MongoClientLike,
} from './types';
