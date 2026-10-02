---
"@teactjs/core": minor
"@teactjs/telegram": minor
"@teactjs/testing": minor
"@teactjs/ui": minor
---

**Framework-agnostic Telegram layer + DX overhaul.**

### New
- `@teactjs/telegram` runs on pluggable drivers: the zero-dependency `fetchDriver()` (default,
  edge-friendly), `grammyDriver()` from `@teactjs/telegram/grammy`, and `gramioDriver()` from
  `@teactjs/telegram/gramio`. With grammY/GramIO, updates pass through that framework's own
  middleware first, so existing plugins keep working.
- `bot.api` / `ctx.api` / `useTelegram().api`: the same Bot API on every driver —
  `api.sendMessage({ chat_id, text })` or `api.call(method, params)`. Errors are
  `TelegramApiError`.
- `bot.send(chatId, text | <JSX/>)` for notifications and broadcasts.
- `createBot({ onError })`, `session.getKey` (per-user sessions in groups), `CommandDef.hidden`.
- `createTestBot()` in `@teactjs/testing`: `send('/start')`, `click('+1')`, `lastMessage.text`.
- Media messages are edited in place; identical re-renders make no API call; forum topics
  are supported; long callback data is aliased automatically; `useStream` gains `error`/`stop()`.
- Middleware can `return false` to stop processing.

### Breaking changes & migration
- `grammy` is no longer a dependency of `@teactjs/telegram`. To keep using grammY:
  `bun add grammy` and `new TelegramAdapter({ driver: grammyDriver() })`.
  `adapter.use()` / `adapter.getBot()` require the grammY or GramIO driver.
- `BotContext.raw` is now the raw Telegram `Update` (snake_case, e.g. `raw.callback_query`),
  not a grammY context. The framework context is available as `ctx.native`.
- `useTelegram().api` takes Bot API params objects:
  `api.sendMessage(chatId, 'hi')` → `api.sendMessage({ chat_id: chatId, text: 'hi' })`.
- `Conversation.raw` is `{ ctx }` (the Teact context). `conversation.api` uses params objects.
- `streamPlugin()` is a deprecated no-op — streaming is built in. Remove it.
- Commands now run *after* middleware/plugins (so auth and rate limits apply to them).
- `Adapter.connect` receives an optional token; `canEdit`/`send` take optional
  `messageId`/`{ threadId }` arguments (custom adapters keep working).
