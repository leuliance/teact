import React, { useState, useContext, useCallback, useMemo, createContext } from 'react';
import i18next, { type i18n as I18nextInstance } from 'i18next';
import { initReactI18next, useTranslation, I18nextProvider } from 'react-i18next';
import { RuntimeContext } from './context';

/** Result of {@link createI18n}: a React `Provider` and the underlying i18next `instance`. */
export interface I18nInstance {
  Provider: (props: { children: React.ReactNode }) => React.ReactElement;
  instance: I18nextInstance;
}

/** Configuration for {@link createI18n}. */
export interface I18nConfig {
  /** Language code used on first load (e.g. `'en'`). */
  defaultLocale: string;
  /** i18next-style resources keyed by locale, each containing a `translation` object. */
  resources: Record<string, { translation: Record<string, any> }>;
  /** Locale to fall back to when a key is missing. Defaults to `defaultLocale`. */
  fallbackLocale?: string;
  /**
   * Pick the initial locale from the user's Telegram app language (`language_code`) when
   * it's one of `resources`. @default true
   */
  detectLocale?: boolean;
  /**
   * Session key the chosen locale is persisted under, so it survives restarts and
   * `/start`. Set `false` to keep it in memory only. @default 'locale'
   */
  sessionKey?: string | false;
}

/** The user's Telegram language from whatever update this is (`from.language_code`). */
function updateLanguage(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  for (const value of Object.values(raw)) {
    const v = value as any;
    const code = v?.from?.language_code ?? v?.user?.language_code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** Match `pt-br` → `pt-br` or `pt` against the available locales. */
function matchLocale(code: string | undefined, available: string[]): string | undefined {
  if (!code) return undefined;
  const lower = code.toLowerCase();
  return available.find((l) => l.toLowerCase() === lower)
    ?? available.find((l) => l.toLowerCase() === lower.split('-')[0]);
}

interface LocaleContextValue {
  locale: string;
  setLocale: (lng: string) => void;
}

const LocaleCtx = createContext<LocaleContextValue | null>(null);

/**
 * Create an i18n instance powered by i18next + react-i18next.
 *
 * Each locale must have a `translation` key following the i18next convention.
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
  const instance = i18next.createInstance();
  instance.use(initReactI18next).init({
    resources: config.resources,
    lng: config.defaultLocale,
    fallbackLng: config.fallbackLocale ?? config.defaultLocale,
    interpolation: { escapeValue: false },
  });

  const available = Object.keys(config.resources);
  const sessionKey = config.sessionKey ?? 'locale';

  function Provider({ children }: { children: React.ReactNode }): React.ReactElement {
    const runtime = useContext(RuntimeContext);
    const stored = sessionKey && runtime ? runtime.session[sessionKey] : undefined;
    const detected = config.detectLocale === false ? undefined : matchLocale(updateLanguage(runtime?.botCtx.raw), available);
    const [locale, setLocaleState] = useState<string>(
      (typeof stored === 'string' && available.includes(stored) ? stored : undefined) ?? detected ?? config.defaultLocale,
    );

    const setLocale = useCallback((lng: string) => {
      if (!available.includes(lng)) {
        console.warn(`[teact] setLocale("${lng}"): no such locale. Available: ${available.join(', ')}`);
        return;
      }
      setLocaleState(lng);
      if (sessionKey && runtime) runtime.updateSession({ [sessionKey]: lng });
    }, [runtime]);

    const ctxValue = useMemo<LocaleContextValue>(
      () => ({ locale, setLocale }),
      [locale, setLocale],
    );

    return React.createElement(
      LocaleCtx.Provider,
      { value: ctxValue },
      React.createElement(I18nextProvider, { i18n: instance } as any, children),
    );
  }

  return { Provider, instance };
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
    availableLocales: Object.keys(i18n.options.resources ?? {}),
  };
}
