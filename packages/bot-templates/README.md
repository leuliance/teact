# @teactjs/bot-templates

Internal package that generates the file tree for new Teact projects. Used by:

- **`create-teact`** (`bun create teact`, `npx create-teact`)
- **`@teactjs/cli`** (`teact create <name>`)

Do not import this from application bots; it is only for scaffolding. The public API is `getTemplateFiles`, `getTemplate`, `buildDependencies`, `buildEnvContent`, and the `TEMPLATE_SELECT_OPTIONS` / `FEATURE_SELECT_OPTIONS` metadata used by the CLIs.

Published to npm so the CLIs can resolve it when installed globally or via `npx`.
