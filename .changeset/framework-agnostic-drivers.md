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
- Payments: `useInvoice` ignores double taps / concurrent sends, validates invoices locally
  (`validateInvoice`: integer positive amounts, payload ≤128 bytes, tips, Stars rules), never
  sends a provider token for Stars (`providerToken` is optional), and gains `reset()`.
  Pre-checkout queries are answered first (a crashing listener can't block them), time out
  to a decline after 8s, and only an explicit `true` approves. New `onShippingQuery` option
  for flexible invoices (unanswered shipping queries are declined with a warning).
- Forms (`useForm` / `useConversation` / `<Form>` / `<Conversation>`): only the user who
  started a form can answer it in groups; a stale/double tap can't answer the next question;
  progress survives restarts and serverless instances (stored in the session); `/commands`
  are never taken as answers; throwing or falsy validators show "Invalid input"; fields added
  later are picked up; `goTo()` can jump forward; `isWaiting` is accurate; one message answers
  only one of two visible forms.
- Conversations plugin: owner-only answers/taps/cancel in groups, per forum topic, own-contact
  check for `requestContact`, slow handlers no longer freeze the chat (`conversation.signal`),
  `/cmd@other_bot` ignored, non-message updates pass through, long streams continue in a new
  message.
- Router: route params are URL-encoded (a param like `1/delete` can't hijack another route);
  taps on a screen you navigated past with `push` are ignored; long callback aliases persist in
  the session store (work after restarts) and work inside forum topics.
- The default error screen no longer shows `error.message` to users (it goes to `onError`).
- `bot.broadcast` de-duplicates chat ids and only counts messages actually sent.
- Rendering: formatting components under a Markdown `parseMode` switch to HTML (with a
  warning) instead of producing invalid markup; over-long HTML text falls back to safe plain
  text; truncation never splits emoji; notifications clamp to 200 chars; media-group captions
  clamp to 1024; one-item media groups keep parse mode/spoiler; warnings for >100 inline
  buttons, >8 per row, dropped keyboards, and poll limits.
- Hooks: `useQuery` tracks loading/error per key (no stuck spinner after switching keys);
  `useMutation` — the latest call wins; `useStream().stop()` flushes pending text;
  `useDeepLink().payload` only returns valid payloads; `<Pagination>`/`usePagination` clamp.
- `inlineQueryPlugin` drops duplicate result ids (Telegram rejects the whole answer otherwise).

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
