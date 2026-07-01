# @teactjs/core

## 0.2.0-alpha.1

### Patch Changes

- Harden the whole library for serverless and correctness.

  - Core: serialize updates per chat, await session writes and the render commit before `bot.fetch()` returns (no dropped sends/writes on the edge), plugin dedupe, memory-store edge warning.
  - Telegram: automatic HTML escaping (fixes injection + parse-mode 400s), media-group/length/poll validation, edit-vs-media guard, wire `<Notification>` to `answerCallbackQuery`, remove duplicate auto-retry.
  - Router: static-over-param precedence, guard-rendered params, trailing-slash matching, redirect-loop/thrown-guard fail closed to notFound.
  - Storage: file driver guards no-fs runtimes and writes atomically.
  - CLI/scaffolder: register plugins via `createBot({ plugins })` so they load on the edge; drop conflicting i18next deps.
