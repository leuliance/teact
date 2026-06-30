# showcase-bot

The full-featured Teact example — a Pokédex bot that exercises most of the framework: routing, deep links, storage, conversations, streaming, i18n, payments, and auth guards.

It's the same project `bun create teact` generates when you pick the **Showcase** template with all features enabled.

## Run it

From the monorepo root, dependencies are linked via workspaces. Then:

```bash
cd examples/showcase-bot
cp .env.example .env          # add your TELEGRAM_BOT_TOKEN from @BotFather
bun install                   # if you haven't installed from the root
bun dev                       # start with hot reload
```

Send `/start` to your bot in Telegram.

## Environment

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...     # required
PAYMENT_PROVIDER_TOKEN=...               # only needed for the /store payments demo
```

## What's inside

| Area | Where | Highlights |
|------|-------|------------|
| Routing & deep links | `src/index.tsx`, `src/commands.ts` | `createRouter`, params (`/pokemon/:id`), `deepLink` payloads |
| Data fetching | `src/api/`, `src/hooks/`, `src/pages/Pokemon*` | `useQuery` against the PokéAPI |
| UI components | `src/pages/ComponentShowcase.tsx` | messages, keyboards, media, polls, formatting |
| Storage | `src/pages/Settings.tsx` | `useStorage` with the file driver |
| Conversations | `src/pages/Feedback*` | multi-step flows via `defineConversation` |
| Streaming | `src/pages/StreamDemo.tsx` | live message updates with `useStream` |
| Auth guards | `src/pages/Secret*`, `LoginPage.tsx` | `beforeLoad` redirect / JSX / reply guards, `useAuthSession` |
| i18n | `src/locales/`, `LanguagePage.tsx` | `createI18n`, `useLocale` |
| Payments | `src/pages/StorePage.tsx` | Telegram invoices with `useInvoice` |

## Commands

`/start`, `/pokedex`, `/showcase`, `/stream`, `/settings`, `/language`, `/store`, `/secret`, `/help` — see `src/commands.ts`.

## Learn more

📖 [Documentation](https://teact-docs.vercel.app/) · [Teact on GitHub](https://github.com/leuliance/teact)
