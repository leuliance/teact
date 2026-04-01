# create-teact

Interactive project scaffolder for Teact. The fastest way to start a new Telegram bot.

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
2. Lets you pick a template: `router`, `counter`, `full`, or `empty`
3. Lets you select features: storage, conversations, streaming, auth, i18n, payments
4. Asks which package manager to use (`bun`, `npm`, or `pnpm`)
5. Asks whether to install dependencies
6. Generates the project with `package.json`, `tsconfig.json`, `teact.config.ts`, `.env`, `.gitignore`, and `src/` files
7. Feature pages are wired into the router and main menu automatically

## Templates

| Template | Description |
|----------|-------------|
| `router` | Multi-page bot with routing and pages directory (recommended) |
| `counter` | Minimal counter bot with inline keyboard |
| `full` | Router + all features pre-wired (storage, conversations, streaming, auth, i18n, payments) |
| `empty` | Bare project with no pages |

## Features

When you pick the `router` template, you can opt into features:

| Feature | What it adds |
|---------|-------------|
| Storage | `teact.config.ts` with `storagePlugin`, Settings page with `useStorage` |
| Conversations | `conversationsPlugin` in config |
| Streaming | `streamPlugin` in config, StreamDemo page with `useStream` |
| Auth | `authPlugin` in config |
| i18n | Locale JSON files, LanguagePage with `useLocale`, `createI18n` in index |
| Payments | StorePage with `useInvoice`, `PAYMENT_PROVIDER_TOKEN` in `.env` |

## Generated Structure

```
my-bot/
├── teact.config.ts       # Plugin configuration
├── package.json
├── tsconfig.json
├── .env                  # Bot token + provider token
├── .gitignore
└── src/
    ├── index.tsx          # Bot entry — router, commands, providers
    ├── pages/
    │   ├── MainMenu.tsx   # Home page with feature buttons
    │   ├── About.tsx
    │   ├── Settings.tsx   # (storage)
    │   ├── StreamDemo.tsx # (streaming)
    │   ├── LanguagePage.tsx # (i18n)
    │   └── StorePage.tsx  # (payments)
    └── locales/           # (i18n)
        ├── en.json
        └── am.json
```

## After Scaffolding

```bash
cd my-bot
# Add your bot token to .env
bun dev
```

## See Also

- [`@teact/cli`](../cli) for the full CLI tool
- [Root README](../../README.md) for getting started
