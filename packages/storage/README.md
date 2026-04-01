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
- **`"file"`** -- persists to disk as JSON files. Set `path` to control the directory.

### Custom Driver

Implement the `StorageDriver` interface:

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
