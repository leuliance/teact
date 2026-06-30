# @teactjs/telegram

Telegram adapter for Teact, powered by [grammY](https://grammy.dev). Handles communication between the Teact runtime and the Telegram Bot API.

## Install

```bash
bun add @teactjs/telegram
```

## Basic Setup

```ts
import { createBot } from "@teactjs/core";
import { TelegramAdapter } from "@teactjs/telegram";

const bot = createBot({
  component: App,
  adapter: new TelegramAdapter(),
  token: process.env.TELEGRAM_BOT_TOKEN,
});

await bot.start();
```

## Polling (Development)

The default mode. The adapter long-polls the Telegram API for updates.

```ts
const bot = createBot({
  component: App,
  adapter: new TelegramAdapter(),
  token: process.env.TELEGRAM_BOT_TOKEN,
  mode: "polling",
});
```

## Webhook (Production)

For production, use webhooks. The adapter starts an HTTP server and registers the webhook URL with Telegram.

```ts
const bot = createBot({
  component: App,
  adapter: new TelegramAdapter(),
  token: process.env.TELEGRAM_BOT_TOKEN,
  mode: "webhook",
  webhook: {
    domain: "https://my-bot.example.com",
    port: 3000,          // default: 3000
    path: "/webhook",    // default: "/webhook"
    secretToken: "s3cr3t", // optional, validates X-Telegram-Bot-Api-Secret-Token header
  },
});
```

## Adapter API

The adapter implements the Teact adapter interface:

| Method | Description |
|--------|-------------|
| `connect({ token })` | Initializes the grammY bot instance |
| `listen({ polling?, webhook? })` | Starts polling or webhook server |
| `send(chatId, output)` | Serializes an `OutputNode` tree and sends it via Telegram |
| `edit(chatId, messageId, output)` | Edits an existing message |
| `clearButtons(chatId, messageId)` | Removes inline keyboard from a message |
| `setCommands(commands)` | Registers bot commands with Telegram |
| `use(...middlewares)` | Adds grammY middleware to the bot instance |
| `disconnect()` | Stops polling or webhook server |
| `getBot()` | Returns the underlying grammY `Bot` instance |

## Conversations Plugin

For imperative multi-step conversation flows:

```ts
import { conversationsPlugin, defineConversation } from "@teactjs/telegram";

defineConversation("onboarding", async (convo) => {
  const name = await convo.prompt("What's your name?");
  await convo.send(`Welcome, ${name}!`);
});

const bot = createBot({
  plugins: [conversationsPlugin()],
  // ...
});
```

The `Conversation` object provides: `prompt`, `send`, `wait`, `ask`, `stream`, `replyWith*` methods, `requestContact`, `requestLocation`, and access to `chatId`, `api`, `chat`, `raw`.

## Stream Plugin

Enables streaming text updates (used with `useStream` in the runtime):

```ts
import { streamPlugin } from "@teactjs/telegram";

const bot = createBot({
  plugins: [streamPlugin()],
  // ...
});
```

## See Also

- [`@teactjs/core`](../core) for the barrel import
- [`@teactjs/runtime`](../runtime) for bot engine docs
- [grammY documentation](https://grammy.dev)
