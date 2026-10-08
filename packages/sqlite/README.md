# @teactjs/sqlite

SQLite storage for Teact: a **synchronous** `StorageDriver` for `useStorage`, a durable session store and a plugin that exposes the database to your components. Works with `bun:sqlite` (built in to Bun) and `better-sqlite3` (Node).

## Install

```bash
bun add @teactjs/sqlite @teactjs/storage
# On Node, also:
npm i better-sqlite3
```

`bun:sqlite` needs no install. `better-sqlite3` is an optional peer dependency.

## Storage

SQLite's API is synchronous, so `SqliteDriver` plugs into `storagePlugin` without the async cache layer. Every `useStorage` read hits the database, and each write is committed before the setter returns.

```ts
import { createBot } from "@teactjs/core";
import { storagePlugin } from "@teactjs/storage";
import { SqliteDriver } from "@teactjs/sqlite";

const sqlite = new SqliteDriver({ path: "./data/bot.db" }); // file and folders created if missing, WAL mode

createBot({
  plugins: [storagePlugin({ driver: sqlite })],
  // ...
});
```

### Clients

```ts
// Bun: open by path. bun:sqlite is loaded lazily.
new SqliteDriver({ path: "./data/bot.db" });

// Bun: your own handle
import { Database } from "bun:sqlite";
new SqliteDriver({ db: new Database("./data/bot.db") });

// Node: better-sqlite3 (also picked up automatically for { path } when bun:sqlite is unavailable)
import Database from "better-sqlite3";
new SqliteDriver({ db: new Database("./data/bot.db") });
```

The driver only closes a database that it opened from `path`. To make it close a database you passed in, set `closeDb: true`.

### Options

| option    | default           | notes                                                           |
| --------- | ----------------- | --------------------------------------------------------------- |
| `path`    |                   | File to open, or `':memory:'`. WAL is enabled for files.        |
| `db`      |                   | An open `bun:sqlite` / `better-sqlite3` database.               |
| `table`   | `'teact_storage'` | Validated: `[A-Za-z_][A-Za-z0-9_]*`, max 63 chars.              |
| `closeDb` | `false`           | Close a passed-in `db` in `close()`.                            |

### Schema

```sql
CREATE TABLE IF NOT EXISTS teact_storage (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS teact_storage_expires_at_idx ON teact_storage (expires_at) WHERE expires_at IS NOT NULL;
```

Values are stored as JSON. `expires_at` holds epoch milliseconds. `createSqliteTableSql(table)` returns this DDL.

### API

```ts
sqlite.get<T>(key)                 // T | undefined (expired rows read as missing)
sqlite.set(key, value, { ttl })    // ttl in ms, optional (0, negative or Infinity = no expiry); set(key, undefined) deletes
sqlite.incr(key, by?, { ttl })     // atomic UPSERT … RETURNING; ttl only when it creates the key; also on asAsync()
sqlite.delete(key); sqlite.has(key)
sqlite.keys(prefix?)               // sorted; prefix matched literally and case-sensitively
sqlite.entries(prefix?)            // [key, value][] in one query
sqlite.clear(prefix?)
sqlite.purgeExpired()              // deletes expired rows, returns the count
sqlite.asAsync()                   // AsyncStorageDriver view (same db), e.g. for TTL-aware code
sqlite.close()
sqlite.db                          // the raw database handle
```

## Sessions

```ts
import { sqliteSessionStore } from "@teactjs/sqlite";

createBot({
  session: { store: sqliteSessionStore(sqlite, { ttl: 7 * 24 * 60 * 60 * 1000 }) },
  // or: sqliteSessionStore({ path: "./data/bot.db" }, { prefix: "session:" })
});
```

`createSessionStore(sqlite)` from `@teactjs/storage` also works, but it ignores `ttl` for sync drivers. `sqliteSessionStore` goes through `asAsync()`, so `ttl` takes effect.

## Plugin and `useSqlite`

`sqlitePlugin` registers the driver as the `'sqlite'` service. It accepts `{ path }`, `{ db }` or a shared `{ driver }`. It closes the database on stop only if it opened it (override with `closeOnStop`).

```tsx
import { sqlitePlugin, useSqlite } from "@teactjs/sqlite";

createBot({ plugins: [storagePlugin({ driver: sqlite }), sqlitePlugin({ driver: sqlite })] });

function Stats() {
  const { db } = useSqlite();
  const { n } = db.prepare("SELECT count(*) AS n FROM teact_storage").get() as { n: number };
  return <Message text={`${n} stored keys`} />;
}
```

## Edge and serverless

SQLite needs a local file and a long-running process. Use it for polling bots and webhook servers on a VM or container. It does **not** work on edge or serverless runtimes such as Cloudflare Workers or Vercel Edge. Use `@teactjs/postgres` with Neon's HTTP driver there.
