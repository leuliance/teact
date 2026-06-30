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
| **AI streaming** | `src/pages/AIAssistant.tsx`, `src/ai/assistant.ts` | LLM-style token-by-token streaming with `useStream` + a live typing cursor; pluggable for a real model (Claude/OpenAI) |
| Plugin SDK + DI | `src/plugins/analytics.ts`, `teact.config.ts` | custom `definePlugin` providing a service, read in the UI via `useService` |
| Routing & deep links | `src/index.tsx` | typed `createRouter`, params (`/pokemon/:id`), **co-located `command:`** per route, `deepLink` payloads |
| Keyboards | `src/pages/MainMenu.tsx` | `<InlineKeyboard columns={2}>` auto-grid + declarative `<Button route="…">` |
| Data fetching | `src/api/`, `src/hooks/`, `src/pages/Pokemon*` | `useQuery` against the PokéAPI |
| UI components | `src/pages/ComponentShowcase.tsx` | messages, keyboards, media, polls, formatting |
| Storage | `src/pages/Settings.tsx` | `useStorage` with the file driver |
| Conversations & forms | `src/pages/Feedback*`, `TrainerProfile.tsx` | multi-step flows (`defineConversation`, `useForm` + zod) |
| Auth guards | `src/pages/Secret*`, `LoginPage.tsx` | `beforeLoad` redirect / JSX / reply guards, `useAuthSession` |
| Events | `src/pages/ContactDemo.tsx` | `useOn` / `useEventData` |
| i18n | `src/locales/`, `LanguagePage.tsx` | `createI18n`, `useLocale` |
| Payments | `src/pages/StorePage.tsx` | Telegram invoices with `useInvoice` |

## Commands

`/start`, `/ai`, `/pokedex`, `/showcase`, `/profile`, `/settings`, `/store`, `/language`, `/secret`, `/admin`, `/help`
— most are **co-located on their routes** in `src/index.tsx` (`command:`); only `/help` (handler-only) is passed to `createBot`.

## Learn more

📖 [Documentation](https://teact-docs.vercel.app/) · [Teact on GitHub](https://github.com/leuliance/teact)
