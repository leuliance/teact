# @teactjs/plugins

Production plugins for [Teact](../../README.md) bots: flood protection, logging,
maintenance mode, chat filters, stale-update dropping, error reporting, analytics,
feature flags, and a rate-limited broadcaster.

## Install

```bash
bun add @teactjs/plugins
# optional — only to share state across instances (Redis, Postgres…)
bun add @teactjs/storage
```

## Quick start

```ts
import { createBot } from "@teactjs/core";
import {
  logger, errorReporter, ignoreOld, maintenance, chatFilter, rateLimit, analytics, featureFlags,
} from "@teactjs/plugins";

createBot({
  component: App,
  plugins: [
    logger({ format: "json" }),            // first: sees and times everything
    errorReporter({ report: (e) => Sentry.captureException(e) }),
    ignoreOld({ maxAge: 120 }),
    maintenance({ isEnabled: () => process.env.MAINTENANCE === "1", allow: [ADMIN_ID] }),
    chatFilter({ allow: ["private"] }),
    rateLimit({ window: 2000, limit: 3, onLimited: "⏳ Slow down!" }),
    analytics(),
    featureFlags({ flags: { newMenu: true }, rollout: { newMenu: 25 } }),
  ],
});
```

### How blocking works

Plugin middleware runs in `plugins` order, before your components. A plugin that
rejects an update calls `halt(ctx)` (exported by `@teactjs/core`): nothing after it
runs and the component is **not rendered**. You can use `halt` in your own middleware:

```ts
import { halt, type Middleware } from "@teactjs/core";
const noBots: Middleware = async (ctx) => { if (ctx.user.isBot) halt(ctx); };
```

**Order matters**: put `logger` / `errorReporter` first, cheap filters (`ignoreOld`,
`maintenance`, `chatFilter`, `rateLimit`) next, and `analytics` after the filters if you
only want to count accepted updates.

Every update goes through these plugins, including commands with an inline `handler`
(`createBot({ commands: { ping: { handler: 'pong' } } })`) — the handler runs where the
component would otherwise render, so a halted update never reaches it.

### Notifications (`Reply`)

Options such as `onLimited`, `onBlocked` and `message` accept a `Reply`:

- a `string` — sent as a text message,
- an `OutputNode` — sent as-is,
- `(ctx, reply) => …` — full control (`await reply("text")`, log, ignore…).

### Shared state

`rateLimit` and `analytics` keep counters in memory by default. Pass any
`@teactjs/storage` driver (sync or async — e.g. `RedisDriver`) as `storage` to share
them across instances. Increments are serialized per process; across instances they
are read-modify-write (no atomic INCR in the driver interface), so under heavy
concurrency a few hits may be lost.

---

## `rateLimit(options)`

Flood protection for messages **and** button presses.

| Option | Default | |
| --- | --- | --- |
| `window` | `1000` | Window length in **ms** |
| `limit` | `3` | Updates allowed per window |
| `key` | `'user'` | `'user'`, `'chat'`, or `(ctx) => string \| null` (`null` = don't limit, e.g. admins) |
| `strategy` | `'sliding'` | `'sliding'` (last `window` ms) or `'fixed'` (aligned buckets) |
| `onLimited` | — | `Reply` sent at most **once per window** |
| `storage` | memory | `AnyStorageDriver` for multi-instance limits |
| `prefix` | `'teact:ratelimit:'` | Storage key prefix |

```ts
rateLimit({ window: 60_000, limit: 20, key: "chat", storage: new RedisDriver({ client: redis }) })
```

## `logger(options)`

Logs one entry per update: type (`message` / `command` / `callback_query`), chat id and
type, user, truncated text or callback data, duration, whether it was blocked, and
errors (logged and re-thrown).

| Option | Default | |
| --- | --- | --- |
| `level` | `'info'` | `'debug'` also logs `update.start` |
| `format` | `'pretty'` | or `'json'` (one object per line) |
| `logger` | `console` | `(entry, line) => void` sink, or a console-like `{ info, error, … }` |
| `redact` | — | `['text', 'userId', …]` or `(entry) => entry` |
| `maxTextLength` | `100` | |

```ts
logger({ format: "json", redact: ["text"], logger: (entry) => pino[entry.level](entry) })
```

Render errors are handled by Teact's error boundary and don't reach middleware — use
`errorReporter` for those.

## `maintenance(options)`

```ts
maintenance({
  isEnabled: async () => (await kv.get("maintenance")) === "on", // or `enabled: true`
  allow: [ADMIN_ID],                                            // bypass
  message: "🛠 Back in 10 minutes!",                            // null = silent
})
```

## `chatFilter(options)`

```ts
chatFilter({
  allow: ["private"],           // 'private' | 'group' | 'supergroup' | 'channel'
  users: [ADMIN_ID],            // optional allow-list (user ids)
  block: [SPAMMER_ID, -100123], // deny-list of user or chat ids — always wins
  onBlocked: "Please DM me.",
})
```

The chat type comes from the raw Telegram update (`ctx.raw.chat.type`). On adapters
without it, `chatId === userId` counts as `private`; anything else is unknown and
blocked when `allow` is set.

## `ignoreOld(options)`

Drops messages older than `maxAge` **seconds** (default `300`) — e.g. the backlog
Telegram delivers after downtime. Uses the raw message `date`; callback queries and
updates without a date always pass. `onIgnored(ctx, ageSeconds)` is called per drop.

## `errorReporter(options)`

Reports errors from everything after it in the pipeline — later middleware, button
handlers, and component **render errors** (via an error boundary around your app).

```ts
import * as Sentry from "@sentry/bun";

errorReporter({
  report: (err, ctx, info) =>
    Sentry.captureException(err, {
      user: { id: ctx.userId },
      tags: { source: info.source },     // 'middleware' | 'render'
      extra: info.context,
    }),
  notifyUser: "😵 Something went wrong — we've been notified.",
  include: ["user", "chat"],             // + 'text' | 'callbackData' | 'raw' (PII!)
})
```

- Middleware errors are reported and swallowed; `notifyUser` is sent if set.
- Render errors are reported once per update; `notifyUser` replaces Teact's default
  "Something went wrong" fallback (which is used when `notifyUser` is unset). The
  chat recovers on the next update.
- A failing `report()` is logged and never breaks the update.
- Set `captureRenderErrors: false` to only watch middleware.

## `analytics(options)` + `useTrack()`

Counts every update (total and per UTC day), command usage, unique users per day and
custom events; forwards everything to an optional `track(event)` sink.

```ts
const stats = analytics({
  track: (e) => posthog.capture({ distinctId: e.userId, event: e.name, properties: e.properties }),
  storage: new RedisDriver({ client: redis }), // optional
});

await stats.getStats();
// { day: '2026-10-06', updates: 1234, updatesOnDay: 87, uniqueUsers: 31,
//   commands: { start: 40, help: 3 }, events: { purchase_clicked: 5 } }

function BuyButton() {
  const track = useTrack();
  return <Button text="Buy" onClick={() => track("purchase_clicked", { plan: "pro" })} />;
}
```

Built-in events are named `update` with `properties: { type, command? }`. Per-day
counters expire after `retentionDays` (default 90). Call `track` from handlers/effects,
not during render.

## `featureFlags(options)` + `useFlag(name)`

```ts
featureFlags({
  flags: {
    newMenu: true,
    beta: (ctx) => BETA_TESTERS.includes(ctx.userId),
    premium: async (ctx) => (await db.user(ctx.userId)).premium,
  },
  rollout: { newMenu: 25 }, // % of users, stable per user (hash of flag + userId)
});

function Menu() {
  return useFlag("newMenu") ? <NewMenu /> : <OldMenu />;
}
```

Flags are evaluated once per update in middleware (async allowed), then read
synchronously with `useFlag`. Unknown flags are `false`; a throwing predicate counts as
off. Outside components use `plugin.isEnabled(name, ctx)`.

## `createBroadcaster(options)`

Send one message to many chats within Telegram's limits (~30 msg/s per bot).

```ts
const broadcaster = createBroadcaster({
  adapter,                               // the adapter passed to createBot
  recipients: async function* () {       // (async) iterable — stream from your DB
    for await (const u of db.users.find()) yield u.chatId;
  },
  rate: 25,                              // msgs/second (default 25)
  onProgress: (p) => console.log(`${p.processed} processed, ${p.blocked} blocked`),
});

const result = await broadcaster.send("📣 v2 is live!");   // string | OutputNode | (chatId) => …
// { total, sent, blocked: ChatId[], failed: [{ chatId, error }], aborted, durationMs }
await db.users.markInactive(result.blocked);
```

- **403** (bot blocked, kicked, user deactivated) → `result.blocked`, no retry.
- **429** → the whole broadcast pauses for `retry_after`, then retries (`maxRetries`, default 3).
- 5xx / network errors are retried with backoff; anything else goes to `result.failed`.
- Pass `{ signal }` to `send` to abort.

## Not included

A typing indicator plugin is not provided: the platform-neutral `Adapter` interface
has no chat-action method.
