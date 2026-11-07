# @teactjs/storage

Persistent storage plugin for Teact. Store and retrieve data across bot restarts with file-based or in-memory drivers.

## Install

```bash
bun add @teactjs/storage
```

## Setup

Register the plugin with `createBot`:

```ts
import { createBot } from "@teactjs/core";
import { storagePlugin } from "@teactjs/storage";

const bot = createBot({
  plugins: [
    storagePlugin({
      driver: "file",       // "file" | "memory" | custom StorageDriver
      path: "./data",       // directory for file driver (default: "./data")
    }),
  ],
  // ...
});
```

## useStorage

Per-key reactive storage hook:

```tsx
import { useStorage } from "@teactjs/storage";

function Favorites() {
  const [favorites, setFavorites] = useStorage<string[]>("favorites", []);

  return (
    <Message text={`You have ${favorites.length} favorites`}>
      <InlineKeyboard>
        <Button
          text="Add Pikachu"
          onClick={() => setFavorites([...favorites, "Pikachu"])}
        />
      </InlineKeyboard>
    </Message>
  );
}
```

Use an updater function for changes based on the previous value — it always receives the
freshest stored value, so rapid taps never lose updates:

```tsx
setFavorites((prev) => [...prev, "Pikachu"]);
```

### Scope

```tsx
useStorage("theme", "light");                       // per chat (default) — shared in groups
useStorage("theme", "light", { scope: "user" });    // per user, even inside groups
useStorage("visits", 0, { scope: "global" });       // one value for the whole bot
```

### Async drivers

With an async driver (Redis, KV, a database) the default value shows while the stored one
loads; the third tuple element tells you:

```tsx
const [cart, setCart, { loading }] = useStorage("cart", []);
if (loading) return <Message text="⏳" />;
```

Writes are applied immediately (optimistic) and persisted in the background. On serverless,
`bot.fetch` waits for pending reads and writes before the runtime freezes.

Values must be JSON-serializable. A `BigInt` or a circular object throws a clear error on
`set`; `undefined` deletes the key.

## useGlobalStorage

Access the raw storage interface for advanced operations:

```ts
const storage = useGlobalStorage();

await storage.get("key");
await storage.set("key", value);
await storage.delete("key");
await storage.has("key");
await storage.keys();
await storage.clear();
```

## Drivers

### Built-in

- **`"memory"`** -- in-memory store, cleared on restart. Good for testing.
- **`"file"`** -- a JSON file (`path`, default `.teact/storage.json`). Writes are atomic, a
  corrupt file is moved aside instead of overwritten, and several processes sharing the file
  merge per key. Single-server use only — no filesystem on serverless.
- **`kvStorageDriver(...)`** -- any async key-value store: Redis, Upstash, Cloudflare KV,
  Deno KV, a SQL table.

### Redis / KV

```ts
import { storagePlugin, kvStorageDriver } from "@teactjs/storage";

// Redis (node-redis v4)
storagePlugin({
  driver: kvStorageDriver({
    get: (k) => redis.get(k),
    set: (k, v) => redis.set(k, v),
    delete: (k) => redis.del(k),
    keys: (prefix) => redis.keys(`${prefix}*`), // only needed for keys()/clear()
  }),
});

// Cloudflare KV — bindings exist per request, so pass a getter
let env: Env;
storagePlugin({ driver: kvStorageDriver(() => env?.STORAGE) });
```

### Custom Driver

Implement the `StorageDriver` interface — methods may be sync or async:

```ts
import type { StorageDriver } from "@teactjs/storage";

const redisDriver: StorageDriver = {
  get: async (key) => { /* ... */ },
  set: async (key, value) => { /* ... */ },
  delete: async (key) => { /* ... */ },
  has: async (key) => { /* ... */ },
  clear: async () => { /* ... */ },
  keys: async () => { /* ... */ },
};

storagePlugin({ driver: redisDriver });
```

## See Also

- [`@teactjs/core`](../core) for the barrel import
- [`@teactjs/runtime`](../runtime) for the plugin system
