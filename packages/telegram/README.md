# @teactjs/telegram

The Telegram adapter for Teact — **framework-agnostic**.

Rendering, in-place edits, polling, webhooks, callback answering, payments and
conversations are implemented once in `TelegramAdapter`. The HTTP client underneath is a
pluggable **driver**:

| Driver | Import | Dependencies | Use it when… |
|--------|--------|--------------|--------------|
| `fetchDriver()` *(default)* | `@teactjs/telegram` | none | You want the smallest footprint, or you deploy to the edge |
| `grammyDriver()` | `@teactjs/telegram/grammy` | `grammy` | You already use grammY or want its plugin ecosystem |
| `gramioDriver()` | `@teactjs/telegram/gramio` | `gramio` | You already use GramIO or want its plugins/hooks |

Your components, hooks and tests are identical on every driver.

## Install

```bash
bun add @teactjs/telegram
# optional — only if you use that driver:
bun add grammy   # or: bun add gramio
```

## Basic setup

```ts
import { createBot } from "@teactjs/core";
import { TelegramAdapter } from "@teactjs/telegram";

const bot = createBot({
  component: App,
  adapter: new TelegramAdapter(), // reads TELEGRAM_BOT_TOKEN
});

await bot.start();
```

## Choosing a driver

```ts
import { TelegramAdapter, fetchDriver } from "@teactjs/telegram";
import { grammyDriver } from "@teactjs/telegram/grammy";
import { gramioDriver } from "@teactjs/telegram/gramio";

new TelegramAdapter();                                                   // fetch (default)
new TelegramAdapter({ driver: fetchDriver({ apiRoot: "http://localhost:8081" }) }); // local Bot API server
new TelegramAdapter({ driver: grammyDriver() });                         // grammY
new TelegramAdapter({ driver: gramioDriver() });                         // GramIO
```

### Bring your own grammY / GramIO bot

Updates flow through the framework's own middleware **first**, then into Teact — so
existing plugins (sessions, rate limiters, i18n, logging, `bot.command(...)`) keep working:

```ts
import { Bot } from "grammy";
import { limit } from "@grammyjs/ratelimiter";
import { grammyDriver } from "@teactjs/telegram/grammy";

const grammy = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
grammy.use(limit());
grammy.command("ping", (ctx) => ctx.reply("pong")); // handled by grammY, never reaches Teact

createBot({ component: App, adapter: new TelegramAdapter({ driver: grammyDriver(grammy) }) });
```

```ts
import { Bot } from "gramio";
import { gramioDriver } from "@teactjs/telegram/gramio";

const gramio = new Bot(process.env.TELEGRAM_BOT_TOKEN!).extend(myPlugin);
createBot({ component: App, adapter: new TelegramAdapter({ driver: gramioDriver(gramio) }) });
```

### Writing a driver

A driver is five functions — see `TelegramDriver`:

```ts
const myDriver: TelegramDriver = {
  name: "my-client",
  init: async (token) => client.getMe(),                     // → bot user
  call: (method, params) => client.request(method, params),  // any Bot API method
  onUpdate: (sink) => { onUpdateSink = sink },               // where updates must go
  handleUpdate: (update) => onUpdateSink(update),            // webhook / polling entry
};
```

## The Bot API, the same everywhere

Every driver exposes the Bot API with its native snake_case params:

```ts
await bot.api.sendMessage({ chat_id: 123, text: "Hi" });
await bot.api.call("setMessageReaction", { chat_id, message_id, reaction: [{ type: "emoji", emoji: "👍" }] });

// in components:
const { api, chatId } = useTelegram();
await api.sendDice({ chat_id: chatId });
```

Failures throw `TelegramApiError` (`errorCode`, `description`, `parameters`) regardless of
driver — `isForbiddenError(err)` detects users who blocked the bot.

## Polling (development)

The default. Long-polls `getUpdates`, deletes any webhook first, processes chats
concurrently (one chat is always sequential), retries network blips with backoff, and stops
promptly on `bot.stop()`.

```ts
new TelegramAdapter({
  allowedUpdates: ["message", "callback_query", "poll_answer"], // default: a sensible set
  dropPendingUpdates: true,                                      // skip the backlog on boot
  concurrency: 100,
});
```

## Webhook (production)

Self-hosted server (Bun.serve on Bun, `node:http` elsewhere):

```ts
createBot({
  component: App,
  adapter: new TelegramAdapter(),
  mode: "webhook",
  webhook: { domain: "https://my-bot.example.com", port: 3000, path: "/webhook", secretToken: "s3cr3t" },
});
```

Serverless / edge (Cloudflare Workers, Vercel, Deno, Netlify):

```ts
export default {
  fetch: (req: Request, env: Env) => bot.fetch(req, { token: env.TELEGRAM_BOT_TOKEN, secretToken: env.WEBHOOK_SECRET }),
};
```

Wrong secret → 401. Malformed body → 400. A crash while handling an update is logged and
still answered with 200 — otherwise Telegram redelivers the same update forever.

## Rendering behavior

- **Edits in place**: text ↔ text via `editMessageText`; photo/video/animation/document/audio
  via `editMessageMedia` (or `editMessageCaption` when only the caption changed). Anything
  else (polls, stickers, reply keyboards, albums) is sent as a new message.
- **No-op renders are free**: a re-render identical to what's on screen makes no API call.
- **`<Notification>`** inside a render becomes the callback query's toast/alert. Every
  button tap is answered, so spinners never hang.
- **Limits**: message text is clamped to 4096 visible chars and captions to 1024 (generated
  `<b>`/`<i>` markup doesn't count and is never cut mid-tag); callback data over 64 bytes is
  aliased automatically.
- **Forum topics**: replies go to the topic the user wrote in.

## Payments

`pre_checkout_query` is answered automatically (approve). Decide yourself:

```ts
new TelegramAdapter({
  onPreCheckout: async (q) => (await stockAvailable(q.invoice_payload)) ? true : "Sold out, sorry!",
});
```

## Conversations plugin

Imperative, `await`-style flows — on every driver:

```ts
import { conversationsPlugin, defineConversation } from "@teactjs/telegram";

defineConversation("onboarding", {
  command: "onboard",
  handler: async (c) => {
    const name = await c.prompt("What's your name?", { validate: (v) => v.length > 1 || "Too short" });
    const plan = await c.ask("Pick a plan", [[{ text: "Free", value: "free" }, { text: "Pro", value: "pro" }]]);
    await c.stream(llm.stream(`Write a welcome for ${name} on ${plan}`)); // live-edited message
  },
});

createBot({ plugins: [conversationsPlugin()], /* … */ });
// start it from a button too: <Button text="Onboard" conversation="onboarding" />
```

The `Conversation` object provides `prompt`, `wait`, `ask`, `send`, `stream`, `waitFor(filter)`,
`replyWith*`, `requestContact`, `requestLocation`, plus `chatId`, `api` and `chat`.
Typing a command (e.g. `/start`) cancels the conversation; idle conversations time out
after an hour (`timeoutMs`). Conversations live in memory — on serverless, use the
`useConversation`/`useForm` hooks instead.

> `streamPlugin()` is deprecated and does nothing: streaming is built in.

## Inline mode

```ts
import { inlineQueryPlugin, inlineArticle } from "@teactjs/telegram";

plugins: [
  inlineQueryPlugin(async ({ query }) =>
    (await search(query)).map((p) => inlineArticle({ id: p.id, title: p.name, text: p.summary })),
  ),
];
```

Enable inline mode with @BotFather (`/setinline`). Return `{ results, nextOffset }` to paginate.

## Adapter API

| Member | Description |
|--------|-------------|
| `api` | Framework-agnostic Bot API (`api.sendMessage({...})`, `api.call(method, params)`) |
| `me` | The bot's own user, after `connect()` |
| `driver` | The active driver |
| `connect({ token })` | Initializes the driver (`getMe`) |
| `listen({ polling?, webhook? })` | Starts polling or the webhook server |
| `webhookCallback({ secretToken })` | Web-standard `(Request) => Response` handler |
| `handleUpdate(update)` | Feed one raw update in (custom HTTP routes, queues) |
| `on('update' \| 'update:<type>', fn)` | Observe raw updates (e.g. `'update:inline_query'`) |
| `use(...middleware)` | Register grammY/GramIO middleware (those drivers only) |
| `getBot()` | The underlying grammY/GramIO `Bot` |
| `disconnect()` | Stops polling / the webhook server |
