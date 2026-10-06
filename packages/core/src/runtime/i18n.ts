import React, { useState, useContext, useCallback, useMemo, useRef, useLayoutEffect, createContext } from 'react';
import i18next, { type i18n as I18nextInstance } from 'i18next';
import { initReactI18next, useTranslation, I18nextProvider } from 'react-i18next';
import type { BotContext } from '../renderer';
import { RuntimeContext, type RuntimeContextValue } from './context';

/** Result of {@link createI18n}: a React `Provider` and the underlying i18next `instance`. */
export interface I18nInstance {
  Provider: (props: { children: React.ReactNode }) => React.ReactElement;
  instance: I18nextInstance;
  /** Locales that have resources, in declaration order. */
  availableLocales: string[];
  /**
   * Map any language tag (`'pt-br'`, `'en_US'`, `'AM'`) to one of {@link availableLocales},
   * or `undefined` when nothing matches. Same rules as {@link detectLocale}.
   */
  resolveLocale: (code: string | null | undefined) => string | undefined;
}

/** Resources for a single locale. `translation` is the default i18next namespace. */
export type I18nLocaleResource = { translation: Record<string, any> } & Record<string, Record<string, any>>;

/** Configuration for {@link createI18n}. */
export interface I18nConfig {
  /** Language code used when nothing was persisted or detected (e.g. `'en'`). */
  defaultLocale: string;
  /** i18next-style resources keyed by locale, each containing a `translation` object. */
  resources: Record<string, I18nLocaleResource>;
  /** Locale to fall back to when a key is missing. Defaults to `defaultLocale`. */
  fallbackLocale?: string;
  /**
   * Detect the initial locale from the Telegram user's `language_code`
   * (normalized and matched against `resources`, falling back to the base language,
   * e.g. `pt-br` → `pt-BR` → `pt`). Default `true`.
   */
  detect?: boolean;
  /**
   * Persist the chosen locale in the chat session (under {@link I18nConfig.sessionKey})
   * so it survives restarts and works on serverless with a durable session store.
   * Default `true`.
   */
  persist?: boolean;
  /** Session key used to persist the locale. Default `'__locale'`. */
  sessionKey?: string;
  /** Called after `setLocale` switches to a different, valid locale. */
  onLocaleChange?: (locale: string, previous: string) => void;
}

/** Default session key under which the chosen locale is persisted. */
export const LOCALE_SESSION_KEY = '__locale';

/**
 * Callback-data prefix understood by every i18n `Provider`: a button whose callback data is
 * `__teact_locale:<code>` switches the chat to `<code>` on the next render. Works without
 * in-memory click handlers, so it is safe on serverless. Build it with {@link localeCallbackData}.
 */
export const LOCALE_CALLBACK_PREFIX = '__teact_locale:';

/**
 * Callback data that switches the chat's locale when the button is pressed.
 *
 * @example
 * <Button text="🇫🇷 Français" onClick={localeCallbackData('fr')} />
 */
export function localeCallbackData(locale: string): string {
  return `${LOCALE_CALLBACK_PREFIX}${locale}`;
}

/**
 * Normalize a BCP-47-ish language tag: `'pt_br'` → `'pt-BR'`, `'ZH-hans-cn'` → `'zh-Hans-CN'`.
 * Returns `''` for empty input.
 */
export function normalizeLocale(code: string | null | undefined): string {
  if (!code) return '';
  const parts = String(code).trim().replace(/_/g, '-').split('-').filter(Boolean);
  return parts
    .map((p, i) => {
      if (i === 0) return p.toLowerCase();
      if (p.length === 4 && /^[a-z]+$/i.test(p)) return p[0].toUpperCase() + p.slice(1).toLowerCase();
      if (p.length === 2 || /^\d{3}$/.test(p)) return p.toUpperCase();
      return p.toLowerCase();
    })
    .join('-');
}

/**
 * Match a user's language code against the available locales.
 *
 * Tries, in order: the exact normalized tag (`pt-br` → `pt-BR`), progressively shorter
 * prefixes (`zh-Hant-TW` → `zh-Hant` → `zh`), then any available regional variant of the
 * base language (`pt` → `pt-BR`). Matching is case-insensitive and the returned value is the
 * spelling used in `available`. Returns `undefined` when nothing matches.
 *
 * @example
 * detectLocale('pt-br', ['en', 'pt']);        // 'pt'
 * detectLocale('en_US', ['en-US', 'en']);     // 'en-US'
 * detectLocale('pt', ['en', 'pt-BR']);        // 'pt-BR'
 * detectLocale('xx', ['en']);                 // undefined
 */
export function detectLocale(
  languageCode: string | null | undefined,
  available: readonly string[],
): string | undefined {
  const normalized = normalizeLocale(languageCode);
  if (!normalized || available.length === 0) return undefined;
  const byLower = new Map<string, string>();
  for (const a of available) {
    const key = normalizeLocale(a).toLowerCase();
    if (!byLower.has(key)) byLower.set(key, a);
  }
  const parts = normalized.split('-');
  for (let n = parts.length; n >= 1; n--) {
    const hit = byLower.get(parts.slice(0, n).join('-').toLowerCase());
    if (hit) return hit;
  }
  const base = parts[0].toLowerCase();
  for (const [key, original] of byLower) {
    if (key.split('-')[0] === base) return original;
  }
  return undefined;
}

/**
 * Extract the user's Telegram `language_code` from a bot context, if any.
 * Looks at `user.languageCode`, the grammY context (`raw.from`) and raw Telegram updates.
 */
export function getUserLanguageCode(botCtx: BotContext | null | undefined): string | undefined {
  if (!botCtx) return undefined;
  const fromUser = (botCtx.user as { languageCode?: string } | undefined)?.languageCode;
  if (fromUser) return fromUser;
  const raw = botCtx.raw;
  if (!raw || typeof raw !== 'object') return undefined;
  const candidates = [
    raw.from,
    raw.update?.message?.from,
    raw.update?.callback_query?.from,
    raw.message?.from,
    raw.callback_query?.from,
    raw.callbackQuery?.from,
    raw.inline_query?.from,
    raw.my_chat_member?.from,
  ];
  for (const from of candidates) {
    const code = from?.language_code;
    if (typeof code === 'string' && code) return code;
  }
  return undefined;
}

interface LocaleContextValue {
  locale: string;
  setLocale: (lng: string) => void;
  availableLocales: string[];
}

const LocaleCtx = createContext<LocaleContextValue | null>(null);

/**
 * Create an i18n instance powered by i18next + react-i18next.
 *
 * Each locale must have a `translation` key following the i18next convention.
 *
 * The initial locale of a chat is resolved in this order:
 * 1. the locale persisted in the session (`session.__locale`) — when `persist` is on;
 * 2. the Telegram user's `language_code`, matched with {@link detectLocale} — when `detect` is on;
 * 3. `defaultLocale`.
 *
 * `setLocale()` validates the locale (unknown ones are ignored with a warning) and, when
 * `persist` is on, writes it to the session so it survives restarts / serverless cold starts.
 *
 * @example
 * ```ts
 * import en from './locales/en.json';
 * import am from './locales/am.json';
 *
 * const i18n = createI18n({
 *   defaultLocale: 'en',
 *   resources: {
 *     en: { translation: en },
 *     am: { translation: am },
 *   },
 * });
 * ```
 */
export function createI18n(config: I18nConfig): I18nInstance {
  const detect = config.detect ?? true;
  const persist = config.persist ?? true;
  const sessionKey = config.sessionKey ?? LOCALE_SESSION_KEY;
  const availableLocales = Object.keys(config.resources);

  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    resources: config.resources,
    lng: config.defaultLocale,
    fallbackLng: config.fallbackLocale ?? config.defaultLocale,
    interpolation: { escapeValue: false },
  });

  const resolveLocale = (code: string | null | undefined): string | undefined => {
    if (!code) return undefined;
    if (availableLocales.includes(code)) return code;
    const norm = normalizeLocale(code).toLowerCase();
    return availableLocales.find((l) => normalizeLocale(l).toLowerCase() === norm);
  };

  const readPersisted = (rt: RuntimeContextValue | null): string | undefined =>
    persist ? resolveLocale(rt?.session?.[sessionKey]) : undefined;

  const callbackLocale = (rt: RuntimeContextValue | null): string | undefined => {
    const data = rt?.botCtx?.callbackData;
    if (!data || !data.startsWith(LOCALE_CALLBACK_PREFIX)) return undefined;
    return data.slice(LOCALE_CALLBACK_PREFIX.length);
  };

  const warnUnknown = (lng: string) => {
    console.warn(
      `[teact] i18n: unknown locale "${lng}" ignored. Available: ${availableLocales.join(', ')}`,
    );
  };

  function Provider({ children }: { children: React.ReactNode }): React.ReactElement {
    const rt = useContext(RuntimeContext);

    const [state, setState] = useState(() => {
      const initial =
        readPersisted(rt) ??
        (detect ? detectLocale(getUserLanguageCode(rt?.botCtx), availableLocales) : undefined) ??
        config.defaultLocale;
      return { locale: initial, rev: 0 };
    });

    // The last persisted value we have seen (to adopt changes made elsewhere, e.g. another
    // serverless instance) and an explicit choice still waiting to be durably persisted.
    const seenRef = useRef<string | undefined>(readPersisted(rt));
    const chosenRef = useRef<{ locale: string; writtenTo: RuntimeContextValue | null } | null>(null);
    const handledCallbackRef = useRef<RuntimeContextValue | null>(null);
    const localeRef = useRef(state.locale);

    let locale = state.locale;

    const choose = (lng: string): boolean => {
      const resolved = resolveLocale(lng);
      if (!resolved) {
        warnUnknown(lng);
        return false;
      }
      const previous = localeRef.current;
      if (persist) chosenRef.current = { locale: resolved, writtenTo: null };
      localeRef.current = resolved;
      setState((s) => ({ locale: resolved, rev: s.rev + 1 }));
      if (resolved !== previous) config.onLocaleChange?.(resolved, previous);
      return true;
    };

    // Language-picker buttons (`__teact_locale:<code>`) — handled during render so the very
    // first commit already uses the new locale (no send-then-edit flash, serverless-safe).
    const fromCallback = callbackLocale(rt);
    if (fromCallback && rt && handledCallbackRef.current !== rt) {
      handledCallbackRef.current = rt;
      if (choose(fromCallback)) locale = localeRef.current;
    } else {
      const persisted = readPersisted(rt);
      const chosen = chosenRef.current;
      if (chosen) {
        // A fresh runtime value whose session already carries our choice: it is durable.
        if (rt && rt !== chosen.writtenTo && persisted === chosen.locale) {
          chosenRef.current = null;
          seenRef.current = persisted;
        }
      } else if (persisted && persisted !== seenRef.current) {
        seenRef.current = persisted;
        if (persisted !== state.locale) {
          locale = persisted;
          localeRef.current = persisted;
          setState((s) => ({ locale: persisted, rev: s.rev + 1 }));
        }
      }
    }
    localeRef.current = locale;

    // Persist explicit choices through the *current* runtime value, so the write lands in
    // the session object loaded for this update and is awaited before the update finishes.
    useLayoutEffect(() => {
      const chosen = chosenRef.current;
      if (!chosen || !persist || !rt) return;
      if (rt.session?.[sessionKey] !== chosen.locale) {
        rt.updateSession({ [sessionKey]: chosen.locale });
      }
      chosen.writtenTo = rt;
    });

    const setLocale = useCallback((lng: string) => { choose(lng); }, []);

    const ctxValue = useMemo<LocaleContextValue>(
      () => ({ locale, setLocale, availableLocales }),
      [locale, setLocale],
    );

    return React.createElement(
      LocaleCtx.Provider,
      { value: ctxValue },
      React.createElement(I18nextProvider, { i18n: instance } as any, children),
    );
  }

  return { Provider, instance, availableLocales, resolveLocale };
}

/**
 * Access translations from any component.
 *
 * Returns `t` (bound to the current locale), `locale`, `setLocale`, and `availableLocales`.
 *
 * @example
 * ```tsx
 * const { t, locale, setLocale } = useLocale();
 * return <Message text={t('home.title')} />;
 * ```
 */
export function useLocale() {
  const localeCtx = useContext(LocaleCtx);
  const { i18n } = useTranslation();
  const locale = localeCtx?.locale ?? i18n.language;
  const t = useMemo(() => i18n.getFixedT(locale), [i18n, locale]);

  return {
    t,
    locale,
    setLocale: localeCtx?.setLocale ?? (() => {}),
    availableLocales: localeCtx?.availableLocales ?? Object.keys(i18n.options.resources ?? {}),
  };
}
