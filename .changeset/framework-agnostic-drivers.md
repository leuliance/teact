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
- Plugins: `rateLimitPlugin`, `loggerPlugin`, `inlineQueryPlugin` (inline mode), and
  `kvSessionStore` for durable sessions on Cloudflare KV / Redis / any async KV.
- `bot.broadcast(ids, content)` — paced under Telegram's flood limit, collects failures.
- Hooks: `useChatAction` ("typing…"), `useInterval`, `useDeepLink`.
- UI: `<Underline>`, `<Strike>`, `<Spoiler>`, `<Link>`, `<Mention>`, `<Quote>`, `<Pagination>` +
  `usePagination`, `<Confirm>`; async `onClick`.
- i18n locale persists in the session and is auto-detected from the user's Telegram language;
  `useQuery` caches per chat by default (`scope: 'global'` to share).

- Auth is per user in group chats: a tap only runs a button the tapper would see themselves
  (non-admins can't trigger admin-only buttons on an admin's message); route guards receive
  `user` and `chatId`; a guard redirect replaces the navigation (no later "teleport").
- Taps survive restarts and serverless instances: a fresh instance re-renders before
  dispatching, the tapped label is verified (stale buttons can't hit a different action), and
  the router reopens the user's last screen (`__teact_route` in the session).
- Storage: async drivers (Redis/KV) work — `kvStorageDriver`, loading state, optimistic writes,
  updaters applied to the freshest value; `useStorage(key, default, { scope: 'chat'|'user'|'global' })`.
- Sessions/storage hardened: unserializable values rejected up front, memory sessions are
  copies and swept, session-store outages answer "try again", late writes finish on serverless.
- SECURITY warnings when a webhook runs without a secret token.

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
- **Sessions are per user inside group chats** by default (`platform:chat:user`); private chats
  are unchanged. Return `` `${ctx.platform}:${ctx.chatId}` `` from `session.getKey` for one
  shared group session.
- `StorageDriver` methods may return promises; `useStorage` returns a third tuple element
  (`{ loading }`). `FileDriver.flush()` no longer rewrites the file unless a write failed.
- `Adapter.connect` receives an optional token; `canEdit`/`send` take optional
  `messageId`/`{ threadId }` arguments (custom adapters keep working).
