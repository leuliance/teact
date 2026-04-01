# Teact

**Build Telegram bots with React components and hooks.**

Teact lets you write Telegram bots using the same mental model as React web apps -- components, hooks, state, routing, and JSX -- compiled and served with Bun.

## Features

- **React components** for every Telegram message type (text, photos, video, audio, documents, polls, contacts, locations, stickers, media groups)
- **Inline and reply keyboards** with declarative `<Button>` and `<ReplyButton>` elements
- **File-based routing** with `createRouter`, route guards, params, and navigation modes (push, replace, stack, dismiss)
- **Conversations and forms** -- multi-step flows with validation via `useConversation` and `useForm`
- **Session management** with built-in memory store or bring-your-own
- **i18n** powered by i18next -- `useLocale()` for multi-language bots
- **Payments** via `useInvoice` for Telegram's native invoice API
- **Streaming** for real-time text updates with `useStream`
- **Auth and roles** via `authPlugin`, `useAuth`, and `useAuthSession` (token-based)
- **Persistent storage** with file or memory drivers through `@teactjs/storage`
- **Events** -- subscribe to any Telegram event with `useOn` and `useEventData`
- **Testing utilities** with `MockAdapter` and `renderBot`
- **CLI** for scaffolding, dev server with HMR, production builds, and code generation

## Quick Start

```bash
bun create teact my-bot
cd my-bot
```

The scaffolder prompts you to pick a template and select features (storage, conversations, streaming, auth, i18n, payments). It generates a `teact.config.ts`, wired pages, and a main menu with buttons for every feature you chose.

Add your bot token to `.env`:

```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

Start the dev server:

```bash
bun dev
```

## Minimal Example

```tsx
import { createBot, Message, Button, InlineKeyboard } from "@teactjs/core";
import { TelegramAdapter } from "@teactjs/telegram";

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <Button text="-1" onClick={() => setCount(count - 1)} />
        <Button text="+1" onClick={() => setCount(count + 1)} />
      </InlineKeyboard>
    </Message>
  );
}

const bot = createBot({
  component: Counter,
  adapter: new TelegramAdapter(),
  token: process.env.BOT_TOKEN,
});

bot.start();
```

## Packages

| Package | Description |
|---------|-------------|
| [`@teactjs/core`](./packages/core) | Main entry point -- re-exports React primitives, runtime, and renderer APIs |
| [`@teactjs/react`](./packages/react) | Telegram UI components (`Message`, `Button`, `Photo`, `Poll`, ...) and data hooks |
| [`@teactjs/runtime`](./packages/runtime) | Bot engine -- `createBot`, routing, sessions, hooks, middleware, i18n, payments |
| [`@teactjs/renderer`](./packages/renderer) | Internal React reconciler (private, not published) |
| [`@teactjs/ui`](./packages/ui) | Convenience re-exports of `@teactjs/react` components |
| [`@teactjs/telegram`](./packages/telegram) | Telegram adapter powered by grammY -- polling and webhook support |
| [`@teactjs/storage`](./packages/storage) | Persistent storage plugin with file and memory drivers |
| [`@teactjs/testing`](./packages/testing) | Test utilities -- `MockAdapter`, `renderBot` |
| [`@teactjs/cli`](./packages/cli) | CLI tool -- `create`, `dev`, `build`, `generate`, `doctor` |
| [`create-teact`](./packages/create-teact) | Interactive project scaffolder (`bun create teact`) |

## Examples

| Example | Description |
|---------|-------------|
| [`showcase-bot`](./examples/showcase-bot) | Full-featured bot showcasing routing, storage, conversations, streaming, i18n, payments, and auth |

## Configuration

Create a `teact.config.ts` in your project root:

```ts
import { defineConfig } from "@teactjs/core";
import { storagePlugin } from "@teactjs/storage";

export default defineConfig({
  plugins: [storagePlugin({ driver: "file", path: "./data" })],
});
```

## Links

- [GitHub](https://github.com/leuliance/teact)
- [Contributing](./CONTRIBUTING.md)
- [License](./LICENSE) (MIT)

## License

MIT -- see [LICENSE](./LICENSE).
