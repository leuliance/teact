// @teactjs/redis — Redis storage driver, session store and plugin for Teact.

export { RedisDriver, escapeGlob } from './driver';
export type { RedisDriverOptions } from './driver';
export { redisSessionStore } from './session';
export type { RedisSessionStoreOptions } from './session';
export { redisPlugin, useRedis, REDIS_SERVICE } from './plugin';
export type { RedisPluginOptions } from './plugin';
export {
  fromIoredis,
  fromNodeRedis,
  fromBunRedis,
  fromUpstash,
  toRedisCommands,
  detectRedisClient,
  markNormalized,
} from './client';
export type {
  RedisCommands,
  AnyRedisClient,
  RedisClientKind,
  IoredisLike,
  NodeRedisLike,
  BunRedisLike,
  UpstashLike,
  FromUpstashOptions,
} from './client';
