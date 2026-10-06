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
