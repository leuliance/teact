# @teactjs/mongodb

MongoDB storage for Teact bots: a storage driver for `storagePlugin`, a durable session store and a plugin that exposes your database to components. It uses the official [`mongodb`](https://www.npmjs.com/package/mongodb) driver, which is an optional peer dependency. The package only relies on the structural shape of `Collection`, `Db` and `MongoClient`.

## Install

```bash
bun add @teactjs/mongodb mongodb   # mongodb driver v5, v6 or v7
```

## Storage driver

```ts
import { MongoClient } from 'mongodb';
import { createBot } from '@teactjs/core';
import { storagePlugin } from '@teactjs/storage';
import { MongoDriver } from '@teactjs/mongodb';

const client = await new MongoClient(process.env.MONGO_URL!).connect();
const driver = new MongoDriver({ db: client.db('mybot') });    // collection 'teact_storage'
await driver.ensureIndexes();                                   // TTL index (once, idempotent)

createBot({ plugins: [storagePlugin({ driver })], /* ... */ });
```

You can pass any one of these:

- `collection`: a `Collection`.
- `db` (and optionally `collectionName`, default `'teact_storage'`).
- `client` (and optionally `dbName` and `collectionName`). Set `closeClient: true` to close it when the bot stops.

### How data is stored

Each key is one document:

```js
{ _id: 'telegram:12345:visits', value: { n: 3 }, expiresAt: ISODate('…') /* only with a ttl */ }
```

- **`value`** is stored as native BSON, so you can query and index it like any other field. One consequence: a `Date` you store comes back as a `Date` object, while the JSON-based drivers (Redis, Postgres, SQLite, Cloudflare) return it as an ISO string. Don't rely on either if your code has to run on several backends; store `date.toISOString()` or a timestamp. `undefined` object members are dropped (the driver writes with `ignoreUndefined: true`), just like `JSON.stringify`, instead of the `mongodb` default of storing `null`.
- **Prefix lookups**, which the storage plugin runs on every update, use an anchored, escaped `^prefix` regex on `_id`. That query is served by the `_id` index. `entries()` is a single `find()`.
- **Counters**: `driver.incr(key, by = 1, { ttl })` uses `$inc` in a single `findOneAndUpdate`, so concurrent increments are never lost. An expired document counts as missing and is reset; `ttl` only applies when the increment creates the key.
- **Expiry**: `set(key, value, { ttl })` writes `expiresAt` (`0`, negative or `Infinity` = no expiry). Expired documents are filtered out on read immediately. `ensureIndexes()` creates `{ expiresAt: 1 }` with `expireAfterSeconds: 0`, so MongoDB deletes them in the background. Its TTL monitor runs about once a minute. You can also create the index yourself:

  ```js
  db.teact_storage.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ```

## Sessions

```ts
import { mongoSessionStore } from '@teactjs/mongodb';

createBot({
  session: {
    store: mongoSessionStore({
      db: client.db('mybot'),
      collectionName: 'sessions',
      ttl: 30 * 24 * 3600_000,   // optional: idle sessions expire after 30 days
    }),
  },
  /* ... */
});
```

If you use `ttl`, create the TTL index on that collection once, for example with `new MongoDriver({ db, collectionName: 'sessions' }).ensureIndexes()`.

## Plugin: use the database in components

```tsx
import type { Db } from 'mongodb';
import { mongoPlugin, useMongo } from '@teactjs/mongodb';

createBot({
  plugins: [mongoPlugin({ client, dbName: 'mybot' })],   // or mongoPlugin({ db })
  /* ... */
});

function Profile() {
  const db = useMongo<Db>();
  // db.collection('users').findOne(...) inside a handler or effect
}
```

The `Db` is registered as the `'mongo'` service, and the client, when given, as `'mongoClient'`. The plugin leaves the client open when the bot stops unless you pass `closeOnStop: true`, since you created it.

## Serverless notes

- Create the `MongoClient` once at module scope and reuse it across invocations. Don't connect per request.
- Writes are awaited before `bot.fetch()` resolves, so they are durable even when the function freezes after the response.
- The `mongodb` driver needs TCP sockets. It runs on Node, Bun, Vercel/Netlify Node functions and AWS Lambda. On Cloudflare Workers it needs `nodejs_compat`, and connection reuse is limited, so `@teactjs/cloudflare` (D1) or Upstash Redis are usually a better fit there.
