# @teactjs/core

The Teact engine: a React renderer for Telegram bots, with `createBot`, a router, hooks, i18n, middleware and the plugin host.

Since 0.2.0, the former `@teactjs/react`, `@teactjs/runtime` and `@teactjs/renderer` packages are all part of `@teactjs/core`. Components such as `Message` and `Button` are in [`@teactjs/ui`](../ui). They are not exported from core.

## Install

```bash
bun add @teactjs/core @teactjs/ui @teactjs/telegram react
```

## Example

```tsx
import { createBot, createRouter, useNavigate, useParams, useSession } from '@teactjs/core';
import { Message, InlineKeyboard, Button } from '@teactjs/ui';
import { TelegramAdapter } from '@teactjs/telegram';

function Home() {
  const [session, setSession] = useSession<{ visits?: number }>();
  const navigate = useNavigate();
  return (
    <Message text={`Visits: ${session.visits ?? 0}`}>
      <InlineKeyboard>
        <Button text="+1" onClick={() => setSession({ visits: (session.visits ?? 0) + 1 })} />
        <Button text="Pikachu" route="/pokemon/:id" params={{ id: 25 }} />
        <Button text="Settings" onClick={() => navigate('/settings', { mode: 'push' })} />
      </InlineKeyboard>
    </Message>
  );
}

function Pokemon() {
  const { id } = useParams<'/pokemon/:id'>(); // typed from the path template
  return <Message text={`Pokemon #${id}`} />;
}

function Settings() {
  return <Message text="Settings" />;
}

const bot = createBot({
  adapter: new TelegramAdapter(),
  router: createRouter({
    '/': Home,
    '/pokemon/:id': Pokemon,
    '/settings': { component: Settings, command: { name: 'settings', description: 'Open settings' } },
  }),
  commands: {
    start: { description: 'Start the bot', route: '/' },
    help: { description: 'Show help', handler: 'Use /start to begin.' },
    echo: { description: 'Echo text', handler: (ctx) => ctx.reply(ctx.args.join(' ') || '…') },
  },
});

bot.start(); // reads TELEGRAM_BOT_TOKEN (a .env file is loaded automatically)
```

## Main exports

| Export | Purpose |
| --- | --- |
| `createBot(options)` | Creates a bot from `component` or `router`, plus `adapter`, `token`, `commands`, `plugins`, `middleware`, `providers`, `session: { store, ttl }`, `mode`, `webhook` and `debug`. |
| `bot.start()` / `bot.stop()` | Starts long polling or the webhook server, registers the command menu and handles SIGINT/SIGTERM. `stop()` unmounts the bot and runs the plugins' `onStop` hooks. |
| `bot.fetch(request, { token, secretToken, env })` | Serverless/edge webhook entry point that returns a `Response`. A request with the wrong secret gets a 401. |
| `bot.setCommands()` | Registers the command menu (`setMyCommands`). `fetch()` does not do this, so run it once after you deploy. |
| `getEnv<T>()` | Returns the `env` passed to the most recent `bot.fetch`, such as Cloudflare bindings. Throws if no `env` has been passed yet. |
| `createRouter(routes, { notFound })`, `useNavigate`, `useParams`, `useRoute`, `redirect` | Routing. A route can define `beforeLoad` guards and a co-located `command`. |
| `useSession`, `useBot`, `useChatId`, `useText`, `useCallbackData`, `useCommand`, `usePlatform` | Hooks for the current update and session. |
| `createI18n`, `useLocale`, `localeCallbackData`, `detectLocale`, `normalizeLocale` | i18n built on i18next. |
| `useService`, `useOptionalService`, `defineConfig` | Read services that plugins provide (DI), and type `teact.config.ts`. |
| `compose`, `halt`, `isHalted`, `MemorySessionStore` | Middleware and session helpers. |
| `ErrorBoundary`, `useQuery`, `useMutation`, `Suspense` | Error recovery and async data. |
| `useConversation`, `useForm`, `useStream`, `useOn`, `useInvoice`, `authPlugin`, `useAuth`, media hooks (`usePhoto`…) | Multi-step flows, events, payments and auth. |
| Types: `Adapter`, `BotContext`, `Middleware`, `SessionStore`, `TeactPlugin`, `CommandDef`, … | Contracts for adapters and plugins. |

## Notes

- **Commands.** A command has a `route`, a `handler` (a string or a `(ctx) => …` function) or a `deepLink(args)` resolver. Handler commands still pass through middleware. Routes can declare their own command with `command: { name, description }`.
- **Middleware.** `next()` is called automatically when a middleware returns without calling it. Returning early therefore does not block an update: call `halt(ctx)` to stop the rest of the chain and the render.

  ```ts
  const adminsOnly: Middleware = async (ctx) => { if (!ADMINS.includes(ctx.userId)) halt(ctx); };
  ```
- **`useParams`.** Pass the path template (`useParams<'/team/:tid/member/:mid'>()`) or an explicit shape (`useParams<{ id: string }>()`). With no type argument it returns `Record<string, string>`.
- **i18n.** `createI18n({ defaultLocale, resources })` returns a `Provider`, which you pass as `createBot({ providers: i18n.Provider })`. A chat's starting locale is the one persisted in its session (`session.__locale`). If none is saved, the user's Telegram `language_code` is used (`pt-br` matches `pt-BR`, then `pt`). Otherwise `defaultLocale` applies. `setLocale()` saves the choice, and `<Button onClick={localeCallbackData('fr')} />` switches the locale without an in-memory handler. Set `detect: false` or `persist: false` to turn either step off.
- **Sessions.** The default `MemorySessionStore` lives inside one process. On serverless, pass a durable store, for example `createSessionStore(driver)` from `@teactjs/storage`.
- **Config.** `teact.config.ts` (typed with `defineConfig`) is loaded automatically and supplies `mode`, `webhook`, `plugins`, `middleware` and `session`. If a plugin appears there and also in `createBot({ plugins })`, only the `createBot()` copy is used.
- **Serverless.**

  ```ts
  export default { fetch: (req: Request, env: Env) => bot.fetch(req, { token: env.TELEGRAM_BOT_TOKEN, secretToken: env.WEBHOOK_SECRET, env }) };
  ```

## Docs

- [Package reference](https://teact-docs.vercel.app/docs/packages/core)
- [Configuration](https://teact-docs.vercel.app/docs/getting-started/configuration)
- [Deployment guide](https://teact-docs.vercel.app/docs/guides/deployment)

## License

MIT
