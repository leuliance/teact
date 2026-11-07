# @teactjs/core

Main entry point for the Teact framework. This package is a barrel that re-exports everything you need from `@teactjs/react`, `@teactjs/runtime`, and `@teactjs/renderer`.

## Install

```bash
bun add @teactjs/core
```

## What It Exports

**React primitives** -- `useState`, `useEffect`, `useReducer`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useId`, `use`, `createContext`, `memo`, `Fragment`, `createElement`, `Suspense`

**Components** -- everything from `@teactjs/react`: `Message`, `Button`, `InlineKeyboard`, `Photo`, `Video`, `Audio`, `Document`, `Poll`, `Location`, `Contact`, `Sticker`, `ReplyKeyboard`, `MediaGroup`, formatting components, and more

**Runtime** -- `createBot`, `createRouter`, `useNavigate`, `useParams`, `useRoute`, `useSession`, `useBot`, `usePlatform`, `useChatId`, `useText`, `useCallbackData`, `useCommand`, `useOn`, `useConversation`, `useForm`, `useStream`, `useAuth`, `useInvoice`, `useLocale`, `createI18n`, `defineConfig`, media hooks, and all associated types

**Renderer** -- `TNode`, `TextNode`, `createRoot`, and types `TeactRoot`, `OutputNode`, `User`, `BotContext`, `SessionData`, `SessionStore`, `Middleware`

## Usage

```tsx
import {
  createBot,
  createRouter,
  Message,
  Button,
  InlineKeyboard,
  useState,
  useNavigate,
} from "@teactjs/core";
```

A single import covers the entire framework API. For finer-grained imports, use the individual packages directly.

## Built-in plugins

```ts
import { rateLimitPlugin, loggerPlugin, authPlugin, kvSessionStore } from "@teactjs/core";

createBot({
  // …
  plugins: [
    loggerPlugin(),                                          // ← @ada in 123: "/start" (38ms)
    rateLimitPlugin({ limit: 3, windowMs: 1000, onLimited: () => "Easy there ⏳" }),
    authPlugin({ admins: [123456789] }),
  ],
  // Durable sessions on any async KV — Cloudflare KV, Redis, Upstash, Deno KV…
  session: { store: kvSessionStore(() => env?.SESSIONS, { ttlSeconds: 86_400 }) }, // getter: Workers bindings exist per request
  onError: (err, { source, ctx }) => Sentry.captureException(err, { extra: { source, chat: ctx?.chatId } }),
});
```

Write your own middleware: return `false` to stop an update (e.g. bans, maintenance mode).

## Handy hooks

| Hook | What it does |
|------|--------------|
| `useChatAction('typing', isLoading)` | Shows "typing…" while slow work runs |
| `useInterval(fn, ms \| null)` | Live-updating messages (countdowns, progress) |
| `useDeepLink()` | `/start` payload + `link('ref_42')` → `https://t.me/<bot>?start=ref_42` |
| `useSession()` | Per-chat (or per-user, via `session.getKey`) persisted state |
| `useQuery` / `useMutation` | Data fetching with a per-chat cache |
| `useStream()` | Stream LLM tokens into a message |
| `useTelegram()` | Framework-agnostic Bot API: `api.sendDice({ chat_id })` |

## Serverless & slow APIs

On Workers/Vercel/Lambda the runtime freezes once the webhook response is returned. `bot.fetch`
therefore keeps the request alive until the bot is idle — every data fetch started by the update
(including third-party libraries like TanStack Query or supabase-js) has finished and re-rendered.

```ts
// Cloudflare: reply to Telegram immediately, finish the work in the background
fetch: (req, env, ctx) => bot.fetch(req, { token: env.TELEGRAM_BOT_TOKEN, waitUntil: (p) => ctx.waitUntil(p) })

// tune or disable
bot.fetch(req, { settle: { idleMs: 300, maxMs: 25_000 } });  // defaults
bot.fetch(req, { settle: false });                             // return after the first render
```

`useQuery` never hangs forever: it passes an `AbortSignal` and times out (default 15s).

```ts
useQuery({ key: 'profile', timeout: 5_000, fn: ({ signal }) => fetch(url, { signal }).then((r) => r.json()) });
```

The request is aborted on timeout, when the key changes, and when the component unmounts.

## Proactive messages

```ts
await bot.send(chatId, <Message text="Your order shipped 📦" />);
const report = await bot.broadcast(subscriberIds, "📢 v2 is live!"); // paced under flood limits
console.log(report.sent, report.failed);
```

## See Also

- [Root README](../../README.md) for getting started
- [`@teactjs/react`](../react) for the full component catalog
- [`@teactjs/runtime`](../runtime) for hooks and bot engine docs
