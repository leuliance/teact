# @teactjs/i18n

Internationalization for Teact bots:

- **`i18nPlugin()`**: add i18n through `plugins: [...]`. It is built on `createI18n` from `@teactjs/core` (i18next + react-i18next).
- **Locale resolution per chat**: the locale saved in the session comes first, then the Telegram user's `language_code`, then `defaultLocale`.
- **Persistence**: `setLocale()` writes `__locale` to the chat session. With a durable session store, the choice survives restarts and serverless cold starts.
- **Built-in UI string packs** in 19 languages (`t('teact.cancel')`, `t('teact.pageOf', { page, total })`, …).
- **`<LanguagePicker />`**: a language switcher that also works on serverless.
- **`useFormat()`**: `Intl` helpers bound to the chat locale for numbers, currency, percentages, dates, times, relative time, lists and plurals.
- **Locale metadata**: native name, English name, flag and text direction (RTL for `ar`, `fa`, `he` and `ur`).
- **Typed helpers**: `defineLocales<T>()` and `useT<T>()`.

## Install

```bash
bun add @teactjs/i18n
```

Peer dependencies: `@teactjs/core`, `@teactjs/ui`, `react`.

## Setup

```ts
// teact.config.ts
import { defineConfig } from "@teactjs/core";
import { i18nPlugin } from "@teactjs/i18n";
import en from "./locales/en.json";
import am from "./locales/am.json";
import fr from "./locales/fr.json";

export default defineConfig({
  plugins: [
    i18nPlugin({
      locales: { en, am, fr },   // plain translation objects
      defaultLocale: "en",
      // fallbackLocale: "en",   // default: defaultLocale
      // detect: true,           // use Telegram's language_code
      // persist: true,          // remember the choice in the session
      // packs: true,            // merge the built-in teact.* strings
    }),
  ],
});
```

You can also register the plugin with `createBot({ plugins: [i18nPlugin(...)] })`. If you already have i18next resources, pass `resources: { en: { translation: {...} } }` instead of `locales`.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `locales` | — | `{ [code]: translations }` |
| `resources` | — | i18next resources `{ [code]: { translation, ...namespaces } }` |
| `defaultLocale` | `'en'` if present, otherwise the first locale | Used when nothing is persisted or detected |
| `fallbackLocale` | `defaultLocale` | Source for keys that are missing in the current locale |
| `detect` | `true` | Detect the locale from the Telegram user's `language_code` |
| `persist` | `true` | Store the chosen locale in the session |
| `sessionKey` | `'__locale'` | Session key for the persisted locale |
| `packs` | `true` | `true` merges the built-in packs, `false` disables them, and an object adds or overrides strings per locale |
| `onLocaleChange` | — | `(locale, previous) => void` |

The plugin also registers the i18next instance as the `i18n` service, so `useService('i18n')` returns it. You can reach the core instance through `plugin.i18n`.

## How the locale is chosen

For each chat, the Provider resolves the locale in this order:

1. **Persisted choice**: `session.__locale`, if it names an available locale.
2. **Telegram `language_code`**: the code is normalized and matched against your locales (`detectLocale`). For example:
   - `pt-br` becomes `pt-BR`. If that is not available, it falls back to `pt`.
   - `zh-hant-tw` becomes `zh-Hant-TW`, then `zh-Hant`, then `zh`.
   - A bare `pt` matches an available `pt-BR`.
3. **`defaultLocale`**.

`setLocale(code)` checks the code against the available locales. Matching is case-insensitive, so `'PT-br'` resolves to `'pt-BR'`. Unknown codes are ignored and a warning is logged. When `persist` is on, `setLocale` writes the choice through the runtime's `updateSession`, and the bot waits for that write before the update completes. This is required on serverless.

> Use a durable session store (Redis, KV, Postgres, …) if the choice must survive restarts or serverless cold starts. The default in-memory store is lost when the process exits.

## Translating

```tsx
import { useLocale, useT } from "@teactjs/i18n";
import { Message, InlineKeyboard, Button } from "@teactjs/ui";

function Home() {
  const { t, locale, setLocale, availableLocales } = useLocale();
  return (
    <Message text={t("home.title", { name: "Abebe" })}>
      <InlineKeyboard>
        <Button text={t("teact.settings")} route="/settings" />
        <Button text={t("teact.help")} route="/help" />
      </InlineKeyboard>
    </Message>
  );
}
```

`useT()` is a shortcut for `useLocale().t`.

## Built-in packs

The built-in packs are merged into **your** locales under the `teact` key. They never overwrite keys you define yourself, so to change one string you only redefine that key:

```ts
i18nPlugin({
  locales: {
    en: { greeting: "Hi", teact: { cancel: "Never mind" } }, // overrides one built-in string
    de: { greeting: "Hallo" },
  },
});
```

| Key | en |
| --- | --- |
| `yes` / `no` / `ok` | Yes / No / OK |
| `back` / `next` / `previous` | Back / Next / Previous |
| `cancel` / `done` / `confirm` / `close` | Cancel / Done / Confirm / Close |
| `save` / `edit` / `delete` / `skip` | Save / Edit / Delete / Skip |
| `loading` | Loading… |
| `error` / `tryAgain` | Something went wrong. / Try again |
| `menu` / `settings` / `language` / `help` / `search` | Menu / Settings / Language / Help / Search |
| `pageOf` | Page {{page}} of {{total}} |
| `selectLanguage` | Choose your language |
| `languageChanged` | Language changed to {{language}}. |
| `noResults` | Nothing found. |
| `areYouSure` | Are you sure? |

Shipped languages: `en`, `am` (Amharic), `ar`, `de`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt` (Brazilian wording), `ru`, `sw`, `tr`, `uk`, `zh` (Simplified).

Regional locales such as `pt-BR` or `es-MX` use the pack of their base language. If you pass no locales at all, every pack language becomes available.

You can import the packs directly:

```ts
import { packs } from "@teactjs/i18n";
import { de, ja } from "@teactjs/i18n/locales";
```

To add or adjust a language:

```ts
i18nPlugin({
  locales: { en, fa },
  packs: { fa: { yes: "بله", no: "خیر", cancel: "لغو" /* … */ } },
});
```

Missing keys fall back to `fallbackLocale`.

## `<LanguagePicker />`

```tsx
import { LanguagePicker } from "@teactjs/i18n";

function LanguageScreen() {
  return <LanguagePicker columns={2} onChange={(l) => console.log("switched to", l)} />;
}
// → "Choose your language"
//   [✓ 🇬🇧 English] [🇪🇹 አማርኛ]
//   [🇫🇷 Français]
```

| Prop | Default | Description |
| --- | --- | --- |
| `title` | `t('teact.selectLanguage')` | Message text |
| `columns` | `2` | Buttons per row |
| `locales` | all available | Which locales to show, in this order |
| `onChange` | — | Called with the new locale after a button is pressed |
| `showFlags` | `true` | Prefix each button with a flag emoji |
| `currentMark` | `'✓ '` | Prefix for the current locale |
| `labels` | — | Per-code overrides, e.g. `{ sw: { flag: '🇹🇿' } }` |
| `renderLabel` | — | `(info, isCurrent) => string` |
| `keyboardOnly` | `false` | Render only the `<InlineKeyboard>`, to put inside your own `<Message>` |

The buttons use `__teact_locale:<code>` callback data, and the i18n Provider handles it itself. The locale changes during the same render, so the message is edited in the new language. The picker does not depend on in-memory click handlers, so it also works on serverless. Use `localeCallbackData(code)` to build your own switch buttons:

```tsx
<Button text="🇫🇷 Français" onClick={localeCallbackData("fr")} />
```

## Formatting: `useFormat()`

```tsx
import { useFormat } from "@teactjs/i18n";

function Receipt({ total, items, createdAt }: Props) {
  const f = useFormat({ timeZone: "Africa/Addis_Ababa", currency: "ETB" });
  return (
    <Message
      text={[
        f.plural(items, { one: "{{count}} item", other: "{{count}} items" }),
        f.currency(total),                       // "ETB 1,250.00" / "1.250,00 ETB"
        f.percent(0.15),                         // "15%"
        f.date(createdAt),                       // "Jan 15, 2026"
        f.time(createdAt),                       // "2:30 PM"
        f.relativeTime(createdAt),               // "3 hours ago"
        f.list(["tea", "coffee", "juice"]),      // "tea, coffee, and juice"
      ].join("\n")}
    />
  );
}
```

| Helper | Notes |
| --- | --- |
| `number(v, opts?)` | `Intl.NumberFormat` |
| `currency(v, code?, opts?)` | The code defaults to `useFormat({ currency })`, otherwise `'USD'` |
| `percent(fraction, opts?)` | `0.25` → `25%` |
| `date` / `time` / `dateTime` | Defaults are `dateStyle: 'medium'` and `timeStyle: 'short'` |
| `relativeTime(n, unit)` or `relativeTime(date)` | `numeric: 'auto'`, so you get "yesterday". When you pass a `Date`, the unit is picked automatically |
| `list(items, opts?)` | `Intl.ListFormat` (`type: 'conjunction' \| 'disjunction' \| 'unit'`) |
| `plural(count, forms)` | `Intl.PluralRules`. Forms are keyed by `zero`, `one`, `two`, `few`, `many` and `other` (`other` is required). `{{count}}` is replaced with the formatted number |
| `pluralCategory(count)` | Returns the raw category |

Outside components (in command handlers or middleware), use `createFormatter(locale, options)`.

## Locale metadata

```ts
import { getLocaleInfo, getTextDirection, useLocaleInfo, LOCALE_INFO } from "@teactjs/i18n";

getLocaleInfo("ar");    // { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', flag: '🇸🇦', dir: 'rtl' }
getLocaleInfo("pt-BR"); // { …, flag: '🇧🇷' }
getTextDirection("he"); // 'rtl'

const { nativeName, dir } = useLocaleInfo(); // metadata for the current chat's locale
```

Codes that are not in the table get their names from `Intl.DisplayNames` and a 🌐 flag.

## Type-safe keys

```ts
import { defineLocales, useT } from "@teactjs/i18n";

const en = { greeting: "Hello {{name}}", menu: { title: "Menu" } };

export const locales = defineLocales<typeof en>()({
  en,
  am: { greeting: "ሰላም {{name}}", menu: { title: "ምናሌ" } },
  // fr: { greeting: "Bonjour" },   ✗ compile error: 'menu' is missing
});

function Menu() {
  const t = useT<typeof en>();
  t("menu.title");   // ✓ autocompleted
  t("teact.back");   // ✓ built-in keys are always allowed
  // t("menu.titel"); ✗ compile error
}
```

## Core helpers (re-exported)

`createI18n`, `useLocale`, `detectLocale(languageCode, available)`, `normalizeLocale(code)`, `getUserLanguageCode(botCtx)`, `localeCallbackData(code)`, `LOCALE_SESSION_KEY`, `LOCALE_CALLBACK_PREFIX`.

```ts
detectLocale("pt-br", ["en", "pt"]);    // "pt"
detectLocale("en_US", ["en-US", "en"]); // "en-US"
detectLocale("xx", ["en"]);             // undefined
```

If you prefer providers to plugins, `createI18n` from `@teactjs/core` has the same detection and persistence:

```ts
const i18n = createI18n({ defaultLocale: "en", resources, detect: true, persist: true });
createBot({ component: App, providers: i18n.Provider });
```
