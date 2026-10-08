# @teactjs/redis

Redis storage for Teact bots: a storage driver for `storagePlugin`, a durable session store and a small plugin that exposes your client to components.

It works with every popular client and never makes one of them a hard dependency:

| Client | Runtime | How it's detected |
| --- | --- | --- |
| [`ioredis`](https://github.com/redis/ioredis) | Node / Bun | automatic, or `fromIoredis(client)` |
| [`redis`](https://github.com/redis/node-redis) (node-redis v4/v5) | Node / Bun | automatic, or `fromNodeRedis(client)` |
| Bun's built-in `RedisClient` / `Bun.redis` | Bun | automatic, or `fromBunRedis(client)` |
| [`@upstash/redis`](https://github.com/upstash/redis-js) (HTTP) | Cloudflare Workers, Vercel Edge, Deno, Node | automatic, or `fromUpstash(client)` |

## Install

```bash
bun add @teactjs/redis
# plus ONE client (skip it on Bun if you use Bun's built-in client):
bun add ioredis          # or: redis, @upstash/redis
```

## Storage driver

```ts
import { createBot } from '@teactjs/core';
import { storagePlugin } from '@teactjs/storage';
import { RedisDriver } from '@teactjs/redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
const driver = new RedisDriver({
  client: redis,
  namespace: 'mybot:', // optional: prefix every key, so several bots can share one DB
});

createBot({ plugins: [storagePlugin({ driver })], /* ... */ });
```

Components keep using `useStorage` as usual. Before each update the plugin loads the current chat's keys in one go (one `SCAN` pass plus one `MGET`), and every write is awaited before the update finishes.

### Each client

```ts
// node-redis v4+ (connect before the first update)
import { createClient } from 'redis';
const client = await createClient({ url: process.env.REDIS_URL }).connect();
new RedisDriver({ client });

// Bun's built-in client
import { RedisClient, redis } from 'bun';
new RedisDriver({ client: redis });                     // uses REDIS_URL
new RedisDriver({ client: new RedisClient('redis://localhost:6379') });

// Upstash (HTTP, works on the edge)
import { Redis } from '@upstash/redis';
new RedisDriver({ client: Redis.fromEnv() });

// ioredis Cluster: SCAN runs on every master, multi-key reads/deletes are split per key
new RedisDriver({ client: new Redis.Cluster([{ host: '10.0.0.1', port: 6379 }]) });
```

**ioredis `keyPrefix`**: ioredis applies `keyPrefix` to commands but not to `SCAN` patterns or results, so prefix queries would miss your keys. Don't set `keyPrefix` on a client you pass to the driver; use the driver's `namespace` option instead.

If auto-detection guesses wrong (for example with a wrapped or proxied client), use the matching helper (`fromIoredis`, `fromNodeRedis`, `fromBunRedis`, `fromUpstash`) or pass `clientKind: 'ioredis' | 'node-redis' | 'bun' | 'upstash'`. Any other client works too if you implement the small `RedisCommands` interface (`get`, `set(key, value, ttlMs?)`, `del(keys)`, `scan(pattern)`, plus optional `mget`, `incrby(key, by, ttlMs?)` and `close`) and mark it with `markNormalized()`. An unmarked object is only accepted when its `scan` is an `async function*`; anything else that isn't a recognized client throws a "Could not recognize the Redis client" error rather than being guessed at.

### How data is stored

- **Values** are JSON strings, so any Redis tool can read them. Plain non-JSON strings written by other code come back as strings.
- **TTL**: `driver.set(key, value, { ttl: ms })` becomes `SET key value PX ms`. A `ttl` of `0`, a negative number or `Infinity` means no expiry.
- **Counters**: `driver.incr(key, by = 1, { ttl })` is atomic and takes one round trip: a small Lua script (`EVAL`) runs `INCRBY` (`INCRBYFLOAT` for fractional `by`) and sets the expiry only if the increment created the key, so a counter keeps its first expiry. Because values are JSON and a JSON number is plain digits, `get` reads the counter back as a number. It rejects when the key holds something other than a number.
- **Prefix queries** use `SCAN … MATCH <prefix>*` with `* ? [ ] \` escaped. The driver never calls `KEYS`, so it never blocks the server.
- **`clear()`** only deletes keys under the `namespace`, and never runs `FLUSHDB`. Without a namespace it deletes every key in the database.
- **Upstash** JSON-parses values on read by default. The adapter handles this, so a string `"42"` comes back as `"42"`, not `42`. A stored `null` is told apart from a missing key with `EXISTS`.

### Closing

The client is yours: by default neither the driver nor `redisPlugin` closes a client you pass in. The storage plugin calls `driver.close()` when the bot stops, and that only closes the client if you pass `closeClient: true`. Closing is idempotent across Teact, so a client shared by a driver with `closeClient: true` and `redisPlugin({ closeOnStop: true })` is only closed once.

## Sessions

```ts
import { redisSessionStore } from '@teactjs/redis';

createBot({
  session: {
    store: redisSessionStore({
      client: redis,
      namespace: 'mybot:',
      ttl: 30 * 24 * 3600_000, // optional: expire idle sessions after 30 days
    }),
  },
  /* ... */
});
```

This is equivalent to `createSessionStore(new RedisDriver({ client }), { prefix: 'session:', ttl })` from `@teactjs/storage`.

## Plugin: use the client in components

```tsx
import { redisPlugin, useRedis } from '@teactjs/redis';
import type Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

createBot({
  plugins: [
    redisPlugin({ client: redis, closeOnStop: true }),      // service 'redis'; close it on stop
    storagePlugin({ driver: new RedisDriver({ client: redis }) }),
  ],
  /* ... */
});

function Leaderboard() {
  const redis = useRedis<Redis>();
  // use it in handlers or effects, e.g. redis.zincrby('scores', 1, userId)
}
```

`redisPlugin({ client, closeOnStop = false })` registers the client unchanged under the `'redis'` service, so `useService('redis')` works too.

## Serverless and edge

- **Cloudflare Workers / Vercel Edge**: TCP clients don't work there, so use `@upstash/redis` (HTTP). Create the client once per isolate, at module scope.
- Writes are awaited before `bot.fetch()` resolves, so nothing is lost when the isolate freezes after the response.
- **Long-running servers (ioredis, node-redis, Bun)**: create a single client and reuse it. Close it yourself after `bot.stop()`, or pass `closeClient: true` / `closeOnStop: true` to have Teact close it.
