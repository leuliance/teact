# @teactjs/telegram

The Telegram platform adapter for Teact. It is built on [grammY](https://grammy.dev) with auto-retry, and supports long polling, a built-in webhook server and serverless `bot.fetch()`.

## Install

```bash
bun add @teactjs/telegram @teactjs/core @teactjs/ui react
```

## Example

```tsx
import { createBot } from '@teactjs/core';
import { Message, InlineKeyboard, Button } from '@teactjs/ui';
import { TelegramAdapter, conversationsPlugin, defineConversation, streamPlugin } from '@teactjs/telegram';

const feedback = defineConversation('feedback', async (conversation) => {
  const name = await conversation.prompt("What's your name?");
  const rating = await conversation.ask('Rate us:', [[{ text: '👍', value: 'up' }, { text: '👎', value: 'down' }]]);
  await conversation.send(`Thanks ${name}! (${rating})`);
});

function Home() {
  return (
    <Message text="Hi!">
      <InlineKeyboard>
        <Button text="Leave feedback" conversation={feedback} />
      </InlineKeyboard>
    </Message>
  );
}

const bot = createBot({
  adapter: new TelegramAdapter(),
  component: Home,
  plugins: [conversationsPlugin(), streamPlugin()],
});

bot.start(); // long polling with TELEGRAM_BOT_TOKEN
```

## Running modes

| Mode | How to use it |
| --- | --- |
| Polling (default) | `bot.start()` |
| Webhook server | `createBot({ mode: 'webhook', webhook: { domain, port, path, secretToken } })`, then `bot.start()`. Calls `setWebhook` and serves `POST {path}` (default `/webhook`, port `3000`). |
| Serverless / edge | `bot.fetch(request, { token, secretToken, env })` in a Cloudflare Worker, Vercel or Deno Edge function, or `Bun.serve`. This uses the adapter's web-standard `webhookCallback`. Run `bot.setCommands()` once after you deploy. |

## `TelegramAdapter` options

```ts
new TelegramAdapter({
  client: { apiRoot: 'http://localhost:8081' }, // grammY ApiClientOptions: local Bot API server or a fake API in tests
  botInfo: { id: 123, is_bot: true, first_name: 'My Bot', username: 'my_bot', /* … */ }, // skip getMe on cold start
});
```

Pass `botInfo` on serverless platforms. Otherwise every cold isolate calls `getMe`.

## Main exports

| Export | Purpose |
| --- | --- |
| `TelegramAdapter` | The `Adapter` implementation. `getBot()` returns the underlying grammY `Bot`, and `use(...middleware)` registers grammY middleware. |
| `conversationsPlugin(defs?)` | Wraps `@grammyjs/conversations`. Accepts `{ name: handler }`, or `{ conversations, exitActive }` (with `exitActive` defaulting to `true`, which leaves any active conversation before entering a new one). |
| `defineConversation(name, handler \| { handler, command })` | Registers a conversation next to the component that starts it, and returns its name for `<Button conversation={…}>`. With `command`, a `/command` starts the conversation. |
| `streamPlugin()` | Registers `@grammyjs/stream`. With it, `conversation.stream(asyncIterable)` uses Telegram's native streaming. Without it, `stream()` falls back to sending a message and editing it at a throttled rate. |
| `serializeOutput(node)` | Converts a rendered `OutputNode` into a Telegram send payload (advanced). |
| Types: `TelegramAdapterConfig`, `Conversation`, `ConversationHandler`, `ConversationDef`, `ConversationsPluginOptions`, `ConversationsConfig`, `MediaGroupItem`, `TelegramSendPayload` | |

The `Conversation` object provides `prompt(text, { validate })` (a function or any schema with `.safeParse`, such as Zod), `wait`, `ask`, `send`, `stream`, `requestContact`, `requestLocation`, all the `replyWith*` media helpers, and `api`, `chat` and `raw` for direct access.

## Notes

- A `<Notification>` rendered in response to a button press becomes the answer to that callback query. Otherwise the query is answered with no text, so the button's loading spinner stops.
- An edit that would turn text into media, or media into text, falls back to sending a new message.
- Text that exceeds Telegram's length limits is truncated, with a warning.
- Each update's `languageCode` comes from Telegram's `language_code`, which `createI18n` in `@teactjs/core` uses for detection.
- Conversation state uses grammY's in-memory session. Run conversations in a long-lived process (polling or the webhook server).

## Docs

- [Package reference](https://teact-docs.vercel.app/docs/packages/telegram)
- [Deployment guide](https://teact-docs.vercel.app/docs/guides/deployment)

## License

MIT
