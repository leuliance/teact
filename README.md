# Teact

**Build Telegram bots with React — components, hooks, state, and routing.**

Teact lets you write Telegram bots the way you write React apps. Messages, keyboards, media, and screens are JSX components; state and side effects are hooks; navigation is a router. It runs on [Bun](https://bun.sh), Node, and the edge — on top of **your choice of Telegram framework**: zero-dependency `fetch`, [grammY](https://grammy.dev), or [GramIO](https://gramio.dev).

📖 **[Documentation →](https://teact-docs.vercel.app/)** · 🚀 [Quick start](#quick-start) · 🧩 [Packages](#packages)

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="−1" onClick={() => setCount((c) => c - 1)} />
          <Button text="+1" onClick={() => setCount((c) => c + 1)} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
```

## Quick Start

You need [Bun](https://bun.sh) and a bot token from [@BotFather](https://t.me/BotFather).

```bash
bun create teact my-bot
cd my-bot
```

The scaffolder asks you to pick a template (Starter, Showcase, Counter, or Empty) and toggle features (storage, conversations, streaming, auth, i18n, payments). It generates a wired-up project with `teact.config.ts`, pages, and a main menu.

Add your token to `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

Start the dev server (hot reload included):

```bash
bun dev
```

Open Telegram, send `/start` to your bot, and you're live. 🎉

> **Heads up:** Teact is published under the npm `alpha` tag during early development. `bun create teact` always pulls the latest release.

## Minimal Example

Build it by hand in three small pieces — install, write, run.

```bash
bun add @teactjs/core @teactjs/ui @teactjs/telegram react
```

```tsx
// src/index.tsx
import { useState } from "react";
import { createBot } from "@teactjs/core";
import { Message, Button, ButtonRow, InlineKeyboard } from "@teactjs/ui";
import { TelegramAdapter } from "@teactjs/telegram";

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="−1" onClick={() => setCount((c) => c - 1)} />
          <Button text="+1" onClick={() => setCount((c) => c + 1)} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

const bot = createBot({
  component: Counter,
  adapter: new TelegramAdapter(), // reads TELEGRAM_BOT_TOKEN from the environment
  commands: { start: { description: "Start the counter" } },
});

bot.start();
```

```bash
TELEGRAM_BOT_TOKEN=... bun run src/index.tsx
```

> UI components (`Message`, `Button`, `InlineKeyboard`, `Photo`, …) come from **`@teactjs/ui`**. Engine APIs (`createBot`, `createRouter`, hooks) come from **`@teactjs/core`**. React primitives like `useState` come from `react` (and are also re-exported by `@teactjs/core`).

## Multi-Screen Bots

Real bots have screens. Use `createRouter` and navigate between them with the `useNavigate` hook:

```tsx
import { createBot, createRouter, useNavigate } from "@teactjs/core";
import { Message, Button, ButtonRow, InlineKeyboard } from "@teactjs/ui";
import { TelegramAdapter } from "@teactjs/telegram";

function Home() {
  const navigate = useNavigate();
  return (
    <Message text="🏠 Home">
      <InlineKeyboard>
        <ButtonRow>
          <Button text="About" onClick={() => navigate("/about")} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

function About() {
  return <Message text="Built with Teact — React for Telegram bots." />;
}

const router = createRouter(
  { "/": Home, "/about": About },
  { notFound: () => <Message text="Not found. Try /start." /> },
);

const bot = createBot({
  adapter: new TelegramAdapter(),
  router,
  commands: {
    start: { description: "Start", route: "/" },
    about: { description: "About", route: "/about" },
  },
});

bot.start();
```

## Bring your own Telegram framework

The Telegram adapter is framework-agnostic. Pick a driver — your components, hooks and tests
don't change:

```ts
import { TelegramAdapter } from "@teactjs/telegram";
import { grammyDriver } from "@teactjs/telegram/grammy";
import { gramioDriver } from "@teactjs/telegram/gramio";

new TelegramAdapter();                                // zero dependencies (fetch) — the default
new TelegramAdapter({ driver: grammyDriver() });      // grammY — its plugins keep working
new TelegramAdapter({ driver: gramioDriver(myBot) }); // GramIO — bring your configured bot
```

With grammY/GramIO, every update passes through that framework's middleware first, so you
can adopt Teact screen by screen inside an existing bot.

## Testing

```tsx
import { createTestBot } from "@teactjs/testing";

const t = await createTestBot({ component: Counter });
await t.send("/start");
await t.click("+1");
expect(t.lastMessage?.text).toBe("Count: 1");
```

## Features

- **Components for every Telegram message type** — text, photos, video, audio, documents, polls, contacts, locations, stickers, media groups
- **Inline & reply keyboards** with declarative `<Button>`, `<ButtonRow>`, and `<ReplyButton>`
- **Routing** with `createRouter`, route guards (`beforeLoad`), params, and navigation modes (push, replace, stack, dismiss)
- **Conversations & forms** — multi-step flows with validation via `useConversation` and `useForm`
- **Session management** with a built-in memory store or your own
- **i18n** powered by i18next — `useLocale()` for multi-language bots
- **Payments** via `useInvoice` for Telegram's native invoice API
- **Streaming** for real-time text (e.g. LLM tokens) with `useStream` and `conversation.stream()`
- **Auth & roles** via `authPlugin`, `useAuth`, and `useAuthSession`
- **Persistent storage** with file or memory drivers through `@teactjs/storage`
- **Events** — subscribe to any Telegram update with `useOn` and `useEventData`
- **Framework-agnostic Telegram layer** — zero-dep fetch, grammY or GramIO drivers
- **Smart rendering** — edits in place (including photos/videos), skips no-op edits, answers every button tap, respects Telegram limits
- **Proactive messages** — `bot.send(chatId, <Message …/>)` for notifications and broadcasts
- **Testing utilities** — `createTestBot` (send/click like a user), `MockAdapter`, `renderBot`
- **CLI** for scaffolding, a dev server with HMR, production builds, and code generation

## Packages

| Package | Description |
|---------|-------------|
| [`@teactjs/core`](./packages/core) | Engine — `createBot`, router, hooks, plugin host, the React reconciler, and re-exported React primitives |
| [`@teactjs/ui`](./packages/ui) | UI components (`Message`, `Button`, `Photo`, `Poll`, …) — start here for imports |
| [`@teactjs/telegram`](./packages/telegram) | Framework-agnostic Telegram adapter (fetch / grammY / GramIO drivers) — polling, webhooks, edge, plus `conversationsPlugin` |
| [`@teactjs/plugin-sdk`](./packages/plugin-sdk) | `definePlugin` — author your own plugins with services/DI, providers, and lifecycle |
| [`@teactjs/storage`](./packages/storage) | Persistent storage plugin with file and memory drivers (bring your own for KV/Redis/DB) |
| [`@teactjs/testing`](./packages/testing) | Test utilities — `createTestBot`, `MockAdapter`, `renderBot` |
| [`@teactjs/cli`](./packages/cli) | CLI (`teact`) — `dev`, `build`, `start`, `deploy`, `webhook`, `generate`, `doctor`, `routes`, `typecheck` |
| [`create-teact`](./packages/create-teact) | Interactive project scaffolder (`bun create teact`) |

> The 0.2.0 rewrite folded the old `@teactjs/react`, `@teactjs/runtime`, and `@teactjs/renderer`
> packages into `@teactjs/core`. If you're upgrading, import components from `@teactjs/ui` and
> everything else from `@teactjs/core`.

## Examples

| Example | Description |
|---------|-------------|
| [`showcase-bot`](./examples/showcase-bot) | Full-featured bot — routing, storage, conversations, streaming, i18n, payments, deep links, and auth guards |

Run it locally:

```bash
cd examples/showcase-bot
cp .env.example .env   # add your TELEGRAM_BOT_TOKEN
bun install
bun dev
```

## Configuration

Create a `teact.config.ts` in your project root for plugins and run mode:

```ts
import { defineConfig, authPlugin } from "@teactjs/core";
import { storagePlugin } from "@teactjs/storage";
import { conversationsPlugin } from "@teactjs/telegram";

export default defineConfig({
  mode: "polling", // or "webhook"
  plugins: [
    storagePlugin({ driver: "file", path: ".teact/storage.json" }),
    conversationsPlugin(),
    authPlugin({ admins: [] }),
  ],
});
```

See the [Configuration guide](https://teact-docs.vercel.app/docs/getting-started/configuration) for the full list of options.

> **Deploying to the edge?** Serverless runtimes (Cloudflare Workers, Vercel/Deno Edge) have
> no filesystem, so `teact.config.ts` isn't loaded there. Pass your plugins directly to
> `createBot({ plugins: [...] })` so they run on the worker, and use a durable `SessionStore`
> (KV/Redis/DB) instead of the default in-memory one. `bot.fetch(request)` is the deploy-anywhere
> entry point — see the [Deployment guide](https://teact-docs.vercel.app/docs/guides/deployment).

## Links

- [Documentation](https://teact-docs.vercel.app/)
- [GitHub](https://github.com/leuliance/teact)
- [Contributing](./CONTRIBUTING.md)
- [License](./LICENSE) (MIT)

## License

MIT — see [LICENSE](./LICENSE).
