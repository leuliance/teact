# @teactjs/postgres

Postgres storage for Teact: an `AsyncStorageDriver` for `storagePlugin` and `useStorage`, a durable session store and a plugin for running queries from components.

It works with any Postgres, including **Supabase**, **Neon**, **Vercel Postgres**, RDS, self-hosted servers and PGlite. If you use **Drizzle** or **Prisma**, pass the underlying `pg` pool (for example `new Pool()` used with `drizzle(pool)` or `PrismaPg`).

## Install

```bash
bun add @teactjs/postgres @teactjs/storage
# plus ONE client:
bun add pg                         # node-postgres (Supabase, RDS, Vercel Postgres pool, ...)
bun add postgres                   # postgres.js
bun add @neondatabase/serverless   # Neon: HTTP (edge) or WebSocket Pool
bun add @electric-sql/pglite       # Postgres in WASM, for tests and local dev
```

Every client library is an optional peer dependency. The driver talks to clients through small structural interfaces and never imports them.

## Clients

`new PostgresDriver({ client })` detects the client type automatically. You can also use the adapters to be explicit:

```ts
import { PostgresDriver, fromPg, fromPostgresJs, fromNeon, fromPglite } from "@teactjs/postgres";

// pg: Pool or Client
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
new PostgresDriver({ client: pool }); // or fromPg(pool)

// postgres.js
import postgres from "postgres";
new PostgresDriver({ client: postgres(process.env.DATABASE_URL!) }); // or fromPostgresJs(sql)

// Neon over HTTP: works on the edge
import { neon } from "@neondatabase/serverless";
new PostgresDriver({ client: neon(process.env.DATABASE_URL!) }); // or fromNeon(sql)

// PGlite
import { PGlite } from "@electric-sql/pglite";
new PostgresDriver({ client: new PGlite("./data/pg") }); // or fromPglite(db)

// Anything else: a (text, values) => Promise<rows> function
new PostgresDriver({ client: async (text, values) => (await myClient.run(text, values)).rows });
```

## Storage

```ts
import { createBot } from "@teactjs/core";
import { storagePlugin } from "@teactjs/storage";
import { PostgresDriver } from "@teactjs/postgres";

const pg = new PostgresDriver({ client: pool });

createBot({
  plugins: [storagePlugin({ driver: pg })],
  // ...
});
```

Before each update, `storagePlugin` loads the chat's keys with a single `entries(prefix)` query. It awaits every write before the update finishes, so writes are durable even on serverless.

### Options

| option        | default           | notes                                                             |
| ------------- | ----------------- | ----------------------------------------------------------------- |
| `client`      | (required)        | See [Clients](#clients).                                          |
| `table`       | `'teact_storage'` | Validated and quoted identifier.                                  |
| `schema`      | search_path       | e.g. `'bot'` → `"bot"."teact_storage"`. The schema must exist.    |
| `autoMigrate` | `true`            | Run `CREATE TABLE IF NOT EXISTS` (once, lazily) on first use.     |
| `closeClient` | `false`           | End the client in `close()`, which `storagePlugin` calls on stop. |

### Schema and migrations

```ts
import { createTableSql } from "@teactjs/postgres";
console.log(createTableSql("teact_storage" /*, "schema" */));
```

```sql
CREATE TABLE IF NOT EXISTS "teact_storage" (key TEXT COLLATE "C" PRIMARY KEY, value JSONB NOT NULL, expires_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS "teact_storage_expires_at_idx" ON "teact_storage" (expires_at) WHERE expires_at IS NOT NULL;
```

If you run migrations yourself (Drizzle Kit, Prisma Migrate, Supabase migrations), add this DDL and pass `autoMigrate: false`. `COLLATE "C"` lets the prefix queries (`LIKE 'prefix%'`) use the primary key index.

### API

```ts
await pg.get<T>(key)                 // expiry is checked in SQL against now()
await pg.set(key, value, { ttl })    // upsert; ttl in ms
await pg.delete(key); await pg.has(key)
await pg.keys(prefix?); await pg.entries(prefix); await pg.clear(prefix?)
await pg.purgeExpired()              // DELETE expired rows; returns the count (run from a cron)
await pg.query(sql, values)          // raw parameterised query on the same client
await pg.migrate()                   // create the table now (otherwise lazy)
```

Prefixes are matched literally: `%`, `_` and `\` are escaped.

## Sessions

```ts
import { postgresSessionStore } from "@teactjs/postgres";

createBot({
  session: { store: postgresSessionStore(pg, { ttl: 30 * 24 * 60 * 60 * 1000 }) },
  // or postgresSessionStore({ client: pool, table: "sessions" })
});
```

## Plugin and `usePostgres`

```tsx
import { postgresPlugin, usePostgres } from "@teactjs/postgres";

createBot({ plugins: [storagePlugin({ driver: pg }), postgresPlugin({ driver: pg })] });
// or postgresPlugin({ client: pool, closeOnStop: true })

function Leaderboard() {
  const pg = usePostgres();
  const { data } = useQuery({
    key: "top",
    fn: () => pg.query("SELECT name, points FROM scores ORDER BY points DESC LIMIT 10"),
  });
  // ...
}
```

The plugin registers the driver as the `'postgres'` service. It only ends the client on stop when you pass `closeOnStop: true`.

## Edge and serverless

Neon's HTTP driver (`neon()`) works on Cloudflare Workers, Vercel Edge and other fetch-only runtimes because each query is a single HTTPS request. TCP clients (`pg`, `postgres.js`) need Node or Bun, or a runtime with TCP sockets. On serverless functions, use your provider's pooler, such as Supabase's transaction pooler or Neon's pooled connection string.
