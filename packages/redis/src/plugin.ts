import { useService, type TeactPlugin } from '@teactjs/core';
import { definePlugin } from '@teactjs/plugin-sdk';
import { toRedisCommands, type AnyRedisClient } from './client';

/** Options for {@link redisPlugin}. */
export interface RedisPluginOptions<C = AnyRedisClient> {
  /** Your Redis client. It is exposed unchanged through {@link useRedis}. */
  client: C;
  /**
   * Close the client when the bot stops. Off by default — the client is yours. Closing is
   * idempotent across Teact, so turning it on while sharing the client with a
   * {@link RedisDriver} (`closeClient: true`) is fine.
   * @default false
   */
  closeOnStop?: boolean;
}

/** Service key the client is registered under (`useService('redis')`). */
export const REDIS_SERVICE = 'redis';

/**
 * Make a Redis client available to every component via {@link useRedis}, and (with
 * `closeOnStop: true`) close it when the bot stops.
 *
 * @example
 * import Redis from 'ioredis';
 * const redis = new Redis(process.env.REDIS_URL!);
 * createBot({
 *   plugins: [redisPlugin({ client: redis, closeOnStop: true }), storagePlugin({ driver: new RedisDriver({ client: redis }) })],
 *   ...
 * });
 */
export function redisPlugin<C extends AnyRedisClient>(opts: RedisPluginOptions<C>): TeactPlugin {
  return definePlugin<RedisPluginOptions<C>>({
    name: 'teact-redis',
    setup(ctx) {
      const { client, closeOnStop = false } = ctx.config;
      ctx.provideService(REDIS_SERVICE, client);
      if (closeOnStop) {
        ctx.onStop(async () => {
          let commands;
          try {
            commands = toRedisCommands(client);
          } catch {
            return; // unknown client shape — the user manages its lifecycle
          }
          await commands.close?.();
        });
      }
    },
  })(opts);
}

/**
 * The client registered by {@link redisPlugin}, typed as you like.
 *
 * @example
 * const redis = useRedis<Redis>();
 * await redis.incr('global:counter');
 */
export function useRedis<C = AnyRedisClient>(): C {
  return useService<C>(REDIS_SERVICE);
}
