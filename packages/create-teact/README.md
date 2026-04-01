# create-teact

Interactive project scaffolder for Teact. The fastest way to start a new Telegram bot.

Templates live in this package’s **`lib/`** directory — the same files the CLI uses (`teact create` copies them from **`create-teact/lib`** during build).

## Usage

```bash
bun create teact my-bot
```

Or with other package managers:

```bash
npx create-teact my-bot
pnpm create teact my-bot
```

## What It Does

1. Prompts for a project name (if not provided as an argument)
2. Lets you pick a template: **Starter**, **Showcase**, **Counter**, or **Empty**
3. Lets you select plugins: storage, conversations, streaming, auth, i18n, payments (Showcase pre-selects all; Starter starts with none)
4. Asks which package manager to use (`bun`, `npm`, or `pnpm`)
5. Asks whether to install dependencies (install output is shown in the terminal)
6. Generates `package.json`, `tsconfig.json`, `teact.config.ts`, `.env`, `.gitignore`, and `src/` files

## Templates

| Template | CLI flag | Description |
|----------|-----------|-------------|
| **Starter** | `starter` or `router` | Main menu + About; add routes by enabling features |
| **Showcase** | `showcase` or `full` | Full demo (Pokedex, showcase pages, guards, commands with deep links) — features control which plugins are enabled |
| **Counter** | `counter` | Single-screen counter |
| **Empty** | `empty` | One message, no router |

## Features

| Feature | What it adds |
|---------|----------------|
| Storage | `storagePlugin`, Settings page with `useStorage` |
| Conversations | `conversationsPlugin`; full component tour in Showcase when enabled |
| Streaming | `streamPlugin`, StreamDemo with `useStream` |
| Auth | `authPlugin`, guarded secret routes + login flow (Showcase) |
| i18n | Locale JSON, `LanguagePage`, `createI18n` |
| Payments | `StorePage` with `useInvoice`, `PAYMENT_PROVIDER_TOKEN` in `.env` |

## Showcase layout (when that template is selected)

Includes `src/commands.ts` (`/start` deep links, `/help` with inline buttons), nested Pokémon routes, `NotFoundPage`, example middleware, and `experimental: {}` on `createBot` — aligned with `examples/showcase-bot`.

## Generated structure (varies by template)

```
my-bot/
├── teact.config.ts
├── package.json
├── tsconfig.json
├── .env
├── .gitignore
└── src/
    ├── index.tsx
    ├── commands.ts          # (Showcase)
    ├── api/                 # (Showcase — PokeAPI)
    ├── hooks/
    ├── pages/
    └── locales/             # (i18n)
```

## After Scaffolding

```bash
cd my-bot
# Add your bot token to .env
bun dev
```

## See Also

- [`@teactjs/cli`](../cli) for the full CLI tool
- [Root README](../../README.md) for getting started
