import { useLocale } from '@teactjs/core';

/** Deep "same keys, string leaves" shape of a translation object. */
export type LocaleShape<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends Record<string, any> ? LocaleShape<T[K]> : T[K];
};

/**
 * Dotted key paths of a translation object: `{ menu: { title: '' } }` → `'menu.title'`.
 */
export type TranslationKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, any>
      ? `${K}.${TranslationKey<T[K]>}`
      : never;
}[keyof T & string];

/** Interpolation values / i18next options passed to `t`. */
export type TOptions = Record<string, unknown>;

/** A `t` function restricted to the keys of `T` (or any string when `T` is not given). */
export type TypedT<T = unknown> = unknown extends T
  ? (key: string, options?: TOptions) => string
  : (key: TranslationKey<T> | `teact.${string}`, options?: TOptions) => string;

/**
 * Type-check that every locale has exactly the keys of the base (reference) locale.
 * Missing keys and unknown keys are compile errors; values must be strings.
 *
 * Call it twice — once with the base type, once with the locales — so TypeScript can infer
 * the locale codes while checking the shape.
 *
 * @example
 * const en = { greeting: 'Hello', menu: { title: 'Menu' } };
 *
 * export const locales = defineLocales<typeof en>()({
 *   en,
 *   am: { greeting: 'ሰላም', menu: { title: 'ምናሌ' } },
 *   fr: { greeting: 'Bonjour' },              // ✗ error: property 'menu' is missing
 * });
 *
 * i18nPlugin({ locales, defaultLocale: 'en' });
 */
export function defineLocales<Base>() {
  return <L extends Record<string, LocaleShape<Base>>>(
    locales: L & { [K in keyof L]: LocaleShape<Base> & Record<Exclude<keyof L[K], keyof Base>, never> },
  ): { [K in keyof L]: LocaleShape<Base> } => locales;
}

/**
 * Shortcut for `useLocale().t`. Pass your base locale type to get key autocompletion and
 * compile-time checks on keys.
 *
 * @example
 * const t = useT<typeof en>();
 * t('menu.title');            // ✓
 * t('menu.titel');            // ✗ type error
 * t('teact.cancel');          // built-in pack keys are always allowed
 */
export function useT<T = unknown>(): TypedT<T> {
  return useLocale().t as unknown as TypedT<T>;
}
