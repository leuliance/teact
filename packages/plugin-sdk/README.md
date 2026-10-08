# @teactjs/plugin-sdk

Write Teact plugins with `definePlugin`. A plugin can contribute middleware, React providers, services that components read with `useService` (dependency injection), and start/stop lifecycle hooks.

## Install

```bash
bun add @teactjs/plugin-sdk @teactjs/core react
```

## Example

A maintenance-mode plugin that provides a service, blocks updates with middleware, and wraps the app in a provider:

```tsx
// maintenance-plugin.tsx
import { createContext, useContext, useService, halt } from '@teactjs/core';
import { definePlugin } from '@teactjs/plugin-sdk';

interface Maintenance { enabled: boolean; allow: string[] }

const BannerCtx = createContext('');
export const useBanner = () => useContext(BannerCtx);

export const maintenance = definePlugin<{ enabled?: boolean; allow?: string[]; banner?: string }>({
  name: 'maintenance',
  defaultConfig: { enabled: false, allow: [], banner: '' },
  setup(ctx) {
    const state: Maintenance = { enabled: !!ctx.config.enabled, allow: ctx.config.allow ?? [] };

    // 1. Service, read in components with useService('maintenance').
    ctx.provideService('maintenance', state);

    // 2. Middleware. Returning early does NOT block an update, because next() is called
    //    automatically. Call halt(ctx) to stop the chain and skip the render.
    ctx.middleware(async (update, next) => {
      if (state.enabled && !state.allow.includes(update.userId)) {
        halt(update);
        return;
      }
      await next();
    });

    // 3. Provider that wraps the app tree.
    ctx.addProvider(({ children }) => (
      <BannerCtx.Provider value={ctx.config.banner ?? ''}>{children}</BannerCtx.Provider>
    ));

    // 4. Lifecycle hooks.
    ctx.onStart((adapter) => console.log(`[maintenance] ready on ${adapter.name}`));
    ctx.onStop(() => console.log('[maintenance] stopped'));
  },
});

// In any component:
export function useMaintenance() {
  return useService<Maintenance>('maintenance');
}
```

Register the plugin in `teact.config.ts` or in `createBot({ plugins })`:

```ts
import { defineConfig } from '@teactjs/core';
import { maintenance } from './maintenance-plugin';

export default defineConfig({
  plugins: [maintenance({ enabled: true, allow: ['123456789'], banner: '🛠 Back soon' })],
});
```

## Main exports

| Export | Purpose |
| --- | --- |
| `definePlugin<C>({ name, defaultConfig?, setup })` | Returns a factory `(config?: C) => TeactPlugin`. `config` is shallow-merged over `defaultConfig`. |
| `PluginContext<C>` | The `setup(ctx)` argument: `config`, `middleware(fn)`, `addProvider(Provider)`, `provideService(key, value)`, `onStart(fn)` and `onStop(fn)`. |
| `PluginDefinition<C>`, `PluginFactory<C>` | Definition and factory types. |
| Types re-exported from core: `TeactPlugin`, `ServiceMap`, `Adapter`, `Middleware` | Lets plugin authors import everything they need from one package. |

## Notes

- **Middleware.** Calls to `ctx.middleware` within one plugin run in the order they were registered, with the same rules as the bot's pipeline: `next()` is implied when a middleware returns without calling it, and only `halt(ctx)` from `@teactjs/core` stops the update.
- **Providers.** Several `addProvider` calls nest in order, so the first provider is the outermost.
- **Services.** Services from every plugin are merged into a single container. Read them with `useService(key)`, which throws when the key is missing, or with `useOptionalService(key)`. Use unique keys.
- **Lifecycle.** `onStart` hooks run in order after the adapter connects and receive the adapter. `onStop` hooks run when `bot.stop()` is called. A hook that throws is logged and does not stop other plugins from running.
- **Duplicates.** If a plugin with the same `name` appears in both `teact.config.ts` and `createBot({ plugins })`, only the `createBot()` copy is loaded.
- **Plain objects.** A plugin can also be a plain `TeactPlugin` object (`{ name, middleware, Provider, services, onStart, onStop }`). `definePlugin` is the more convenient way to build one.

## Docs

- [Package reference](https://teact-docs.vercel.app/docs/packages/plugin-sdk)
- [Core package](https://teact-docs.vercel.app/docs/packages/core)
- [Configuration](https://teact-docs.vercel.app/docs/getting-started/configuration)

## License

MIT
