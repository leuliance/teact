# @teactjs/storage

Persistent, chat-scoped storage for Teact bots. Works with synchronous drivers (memory, file) and asynchronous ones (Redis, Postgres, SQLite, MongoDB, Cloudflare KV/D1), and can also back durable sessions.

## Install

```bash
bun add @teactjs/storage @teactjs/core react
```

## Example

```tsx
import { createBot } from '@teactjs/core';
import { Message, InlineKeyboard, Button } from '@teactjs/ui';
import { TelegramAdapter } from '@teactjs/telegram';
import { storagePlugin, useStorage, createSessionStore, FileDriver } from '@teactjs/storage';

function Favorites() {
  const [favorites, setFavorites] = useStorage<number[]>('favorites', []); // scoped to this chat
  return (
    <Message text={`Favorites: ${favorites.join(', ') || 'none'}`}>
      <InlineKeyboard>
        <Button text="Add Pikachu" onClick={() => setFavorites((prev) => [...prev, 25])} />
      </InlineKeyboard>
    </Message>
  );
}

createBot({
  adapter: new TelegramAdapter(),
  component: Favorites,
  plugins: [storagePlugin({ driver: 'file', path: './data/storage.json' })],
  session: { store: createSessionStore(new FileDriver('./data/sessions.json')) },
}).start();
```

To use an asynchronous database, pass its driver. These drivers come from the database packages:

```ts
import { RedisDriver } from '@teactjs/redis';

storagePlugin({ driver: new RedisDriver({ client: redis }), preload: ['global:'] });
```

## Main exports

| Export | Purpose |
| --- | --- |
| `storagePlugin({ driver, path, preload })` | The plugin. `driver` is `'memory'` (the default), `'file'` or a driver instance. `path` applies to `'file'` and defaults to `.teact/storage.json`. |
| `useStorage(key, default)` | A `useState`-like hook that is persisted and stored under `<platform>:<chatId>:<key>`. The setter also accepts an updater function. |
| `useGlobalStorage()` | A synchronous driver that is not scoped to a chat, for data shared across chats. |
| `useStorageBackend()` | The driver exactly as you passed it, sync or async. Use it for queries outside the cache, such as `await backend.keys('leaderboard:')`. |
| `createSessionStore(driver, { prefix, ttl })` | Turns any driver into a `SessionStore` for `createBot({ session: { store } })`. |
| `MemoryDriver`, `FileDriver(path)` | Built-in sync drivers. File writes are atomic (a temp file and then a rename). |
| `MemoryAsyncDriver` | An in-memory async driver that supports TTL and `incr`. Useful in tests and as a reference implementation. |
| `CachedDriver`, `isAsyncDriver` | Internals for the async cache, exported for driver authors. |
| `runDriverConformance(name, make, { describe, test, expect, skipTtl })` | A shared test suite that every `AsyncStorageDriver` should pass. |
| Types: `StorageDriver`, `AsyncStorageDriver`, `AnyStorageDriver`, `SetOptions`, `StoragePluginOptions` | Driver contracts. |

## How async drivers work

Hooks read storage synchronously during render. With an async driver, the plugin therefore keeps a **cache for each update**:

1. Before the update renders, it loads all of the current chat's keys (`<platform>:<chatId>:*`) with a single `entries(prefix)` call, plus every prefix listed in `preload`.
2. Components read from and write to that cache.
3. Every write is **awaited before the update finishes**. Writes therefore survive on serverless and edge platforms, where the isolate freezes after the response.

`useGlobalStorage()` only sees keys from the current chat and from the `preload` prefixes. To read anything else, use `useStorageBackend()`, for example inside `useQuery`.

An `AsyncStorageDriver` is marked `async: true` and implements `get`, `set(key, value, { ttl })`, `delete`, `has`, `keys(prefix?)` and `clear(prefix?)`. These methods are optional:

- `entries(prefix)`: load many keys in a single query.
- `incr(key, by?, { ttl })`: an **atomic** counter (Redis `INCRBY`, a SQL upsert with `RETURNING`, Mongo `$inc`). The TTL is set only when the key is first created. Counters in `@teactjs/plugins` use it so they stay correct across instances.
- `close()`: called from the plugin's `onStop`.

```ts
import { describe, test, expect } from 'bun:test';
import { runDriverConformance } from '@teactjs/storage';

runDriverConformance('MyDriver', () => new MyDriver(), { describe, test, expect });
```

## Database packages

| Package | Backends |
| --- | --- |
| `@teactjs/redis` | `RedisDriver`, `redisSessionStore`, `redisPlugin`. Supports ioredis, node-redis, Bun `RedisClient` and Upstash. |
| `@teactjs/postgres` | `PostgresDriver`, `postgresSessionStore`, `postgresPlugin`. Supports pg, postgres.js, Neon and PGlite. |
| `@teactjs/sqlite` | `SqliteDriver`, `SqliteAsyncDriver`, `sqliteSessionStore`, `sqlitePlugin`. Supports `bun:sqlite` and better-sqlite3. |
| `@teactjs/mongodb` | `MongoDriver`, `mongoSessionStore`, `mongoPlugin`. |
| `@teactjs/cloudflare` | `KVDriver`, `D1Driver`, `kvSessionStore`, `d1SessionStore`. Read bindings lazily with `getEnv()` from `@teactjs/core`. |

## Notes

- `FileDriver` is intended for local development and small single-instance bots. Where there is no writable filesystem (Cloudflare Workers), it warns and keeps data in memory only.
- A sync driver that has a `flush()` method has it called when the bot stops.

## Docs

- [Package reference](https://teact-docs.vercel.app/docs/packages/storage)
- [Deployment guide](https://teact-docs.vercel.app/docs/guides/deployment)

## License

MIT
