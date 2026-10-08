# @teactjs/cloudflare

Storage for Teact bots on Cloudflare Workers:

- **`D1Driver`**: [D1](https://developers.cloudflare.com/d1/) (SQLite). Strongly consistent. **Recommended for bot state and sessions.**
- **`KVDriver`**: [Workers KV](https://developers.cloudflare.com/kv/). Eventually consistent and fast to read globally. Good for settings and caches.
- **`d1SessionStore` / `kvSessionStore`**: durable `SessionStore`s for `createBot({ session: { store } })`.

There are no runtime dependencies. The bindings are typed structurally, so `@cloudflare/workers-types` is optional.

## Install

```bash
bun add @teactjs/cloudflare
```

`wrangler.toml`:

```toml
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "mybot"
database_id = "…"

[[kv_namespaces]]
binding = "BOT_KV"
id = "…"
```

## Bindings: `env` and lazy getters

Workers pass bindings on `env`. There are two ways to reach them.

**1. `import { env } from 'cloudflare:workers'`** with a lazy getter, so the bot can be built once at module scope:

```ts
import { env } from 'cloudflare:workers';
import { createBot } from '@teactjs/core';
import { storagePlugin } from '@teactjs/storage';
import { D1Driver, d1SessionStore } from '@teactjs/cloudflare';

const bot = createBot({
  component: App,
  token: env.BOT_TOKEN,
  plugins: [storagePlugin({ driver: new D1Driver(() => env.DB) })],
  session: { store: d1SessionStore(() => env.DB) },
});

export default { fetch: (req: Request) => bot.fetch(req) };
```

**2. A plain binding**, if you build the bot inside the handler:

```ts
export default {
  fetch(req: Request, env: Env) {
    const driver = new D1Driver(env.DB);
    // ...
  },
};
```

Every driver and session store accepts `binding | (() => binding)`. A getter is resolved on each call, never at construction.

## D1Driver

```ts
new D1Driver(() => env.DB, { table: 'teact_storage' /* default */ });
```

- The table `teact_storage(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)` is created lazily with `CREATE TABLE IF NOT EXISTS`, once per driver instance. Add it to your migrations if you prefer.
- Values are JSON text, and `expires_at` is epoch milliseconds.
- Prefix queries use `LIKE ? ESCAPE '\'` with `% _ \` escaped. SQLite's `LIKE` ignores ASCII case, so the driver adds an exact, case-sensitive match. `entries()` is a single `SELECT`.
- TTL is exact to the millisecond. Expired rows are hidden on read. To reclaim space, call `driver.purgeExpired()` from a Cron Trigger:

  ```ts
  export default {
    fetch: (req: Request) => bot.fetch(req),
    scheduled: () => driver.purgeExpired(),
  };
  ```

## KVDriver

```ts
new KVDriver(() => env.BOT_KV, { namespace: 'mybot:' /* optional key prefix */ });
```

- Values are JSON text.
- **TTL**: KV's minimum `expirationTtl` is **60 seconds**. `set(k, v, { ttl })` converts milliseconds to seconds, rounding up, with a floor of 60s. A `ttl` of 5000 (5s) therefore lives for 60s.
- `keys()` and `clear()` page through `list({ prefix, cursor })`. `entries()` lists the keys, then reads the values in parallel (`concurrency`, default 50).
- **Consistency**: KV is eventually consistent. Writes can take up to about 60s to reach other locations, and KV allows about one write per second per key. Avoid it for per-message state such as counters, multi-step forms or wizards. Use D1 for those.
- **No `incr`**: KV has no atomic increment or compare-and-swap, so `KVDriver` deliberately doesn't implement the optional `incr()` (a get-then-put counter would lose updates). `D1Driver.incr(key, by, { ttl })` is atomic: one `UPSERT … RETURNING` statement.
- **Cost**: each update runs `list` plus one `get` per key in the chat. Keep chat-scoped keys few, or use D1.

## Sessions

```ts
import { d1SessionStore, kvSessionStore } from '@teactjs/cloudflare';

createBot({ session: { store: d1SessionStore(() => env.DB, { ttl: 7 * 24 * 3600_000 }) } });
// or (eventually consistent, ttl rounded up to ≥ 60s):
createBot({ session: { store: kvSessionStore(() => env.SESSIONS, { prefix: 'session:' }) } });
```

## Serverless notes

- The storage plugin awaits every write before `bot.fetch()` resolves, so nothing is lost when the isolate freezes after the response. You don't need `ctx.waitUntil`.
- For Redis on Workers, use `@teactjs/redis` with `@upstash/redis`, which talks HTTP.
