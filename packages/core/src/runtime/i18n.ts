import React, { useState, useContext, useCallback, useMemo, createContext } from 'react';
import i18next, { type i18n as I18nextInstance } from 'i18next';
import { initReactI18next, useTranslation, I18nextProvider } from 'react-i18next';

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

  function Provider({ children }: { children: React.ReactNode }): React.ReactElement {
    const [locale, setLocaleState] = useState(config.defaultLocale);

    const setLocale = useCallback((lng: string) => {
      setLocaleState(lng);
    }, []);

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
