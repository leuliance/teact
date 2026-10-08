---
"@teactjs/core": minor
"@teactjs/storage": minor
"@teactjs/telegram": minor
"@teactjs/testing": minor
"@teactjs/cli": minor
"create-teact": minor
"@teactjs/redis": minor
"@teactjs/postgres": minor
"@teactjs/sqlite": minor
"@teactjs/mongodb": minor
"@teactjs/cloudflare": minor
"@teactjs/i18n": minor
"@teactjs/plugins": minor
---

Databases, locales, production plugins and a much faster CLI.

- **Storage:** async database drivers (`AsyncStorageDriver`) with a per-update cache so `useStorage` stays synchronous and writes are durable before `bot.fetch()` resolves; `createSessionStore(driver)`; `useStorageBackend()`.
- **New database packages:** `@teactjs/redis` (ioredis, node-redis, Bun, Upstash), `@teactjs/postgres` (pg, postgres.js, Neon, PGlite), `@teactjs/sqlite`, `@teactjs/mongodb`, `@teactjs/cloudflare` (KV, D1) — each with a storage driver, session store and plugin.
- **Locales:** core detects the Telegram `language_code` and persists the chosen locale in the session; new `@teactjs/i18n` with UI strings for 19 locales, `<LanguagePicker />` and Intl formatting hooks.
- **`@teactjs/plugins`:** rateLimit, logger, maintenance, chatFilter, ignoreOld, errorReporter, analytics, featureFlags, createBroadcaster.
- **Core:** `halt(ctx)` lets middleware block an update; commands with an inline `handler` now go through middleware.
- **CLI:** ~30x faster startup (lazy command loading), Bun-native `dev` and `build` (Vite still available via `--vite`), `teact add`, smarter `doctor` and `routes`, database choice when scaffolding.

**Fixes from release testing** (code review, real Redis/Postgres/SQLite servers, a real Workers runtime, and fresh installs from packed tarballs): per-update storage caches (no cross-chat leaks or clears), ordered and durable session writes from button handlers, halted commands keep the chat's screen, button presses on a fresh serverless instance edit instead of duplicating, `bot.fetch` rejects a wrong secret before any work, `getEnv()` for Workers bindings, `bot.setCommands()`, `TelegramAdapter({ client, botInfo })`, `bot.start()` fails fast when Telegram is unreachable, atomic `incr()` in the database drivers (exact rate limits and analytics across instances), ioredis Cluster support, publishable type declarations (`dist/index.d.ts`, works with `moduleResolution: node16/nodenext`), and the release script now publishes every package.

**Breaking changes for alpha users**

- The default error screen no longer shows the error message to users (it may contain internals). Pass `fallback` to `ErrorBoundary` to customize it.
- `redisPlugin`, `mongoPlugin`, `RedisDriver` no longer close a client you pass in; opt in with `closeOnStop: true` / `closeClient: true`.
- A storage `ttl` of `0`, a negative number or `Infinity` now means "no expiry" in every driver.
- `escapeLike` is no longer exported from `@teactjs/postgres`, `@teactjs/sqlite` and `@teactjs/cloudflare`.
- A plugin listed in both `teact.config.ts` and `createBot({ plugins })` now uses the `createBot()` copy; repeating a plugin within one list keeps every copy.
- Analytics `getStats()` reads per-name counters; counts recorded by earlier alphas aren't migrated.
