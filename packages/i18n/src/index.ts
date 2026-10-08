// @teactjs/i18n — internationalization plugin, locale packs, language picker and Intl formatting.

import { useLocale } from '@teactjs/core';
import { getLocaleInfo, type LocaleInfo } from './metadata';

export { i18nPlugin, buildResources, PACK_KEY } from './plugin';
export type { I18nPluginOptions, I18nPlugin } from './plugin';

export { LanguagePicker } from './picker';
export type { LanguagePickerProps } from './picker';

export { useFormat, createFormatter } from './format';
export type { Formatter, FormatOptions, PluralForms } from './format';

export { useT, defineLocales } from './typed';
export type { LocaleShape, TranslationKey, TypedT, TOptions } from './typed';

export { LOCALE_INFO, getLocaleInfo, getTextDirection } from './metadata';
export type { LocaleInfo, TextDirection } from './metadata';

export { packs, packLocales } from './locales';
export type { TeactMessages } from './locales';

// Re-export the core primitives so apps need a single import.
export {
  useLocale,
  createI18n,
  detectLocale,
  normalizeLocale,
  getUserLanguageCode,
  localeCallbackData,
  LOCALE_SESSION_KEY,
  LOCALE_CALLBACK_PREFIX,
} from '@teactjs/core';
export type { I18nConfig, I18nInstance, I18nLocaleResource } from '@teactjs/core';

/**
 * Metadata (native name, English name, flag, text direction) for the current chat's locale.
 *
 * @example
 * const { nativeName, dir } = useLocaleInfo();
 */
export function useLocaleInfo(): LocaleInfo {
  return getLocaleInfo(useLocale().locale);
}
