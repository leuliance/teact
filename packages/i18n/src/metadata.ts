import { detectLocale, normalizeLocale } from '@teactjs/core';

/** Writing direction of a language. */
export type TextDirection = 'ltr' | 'rtl';

/** Display metadata for a locale. */
export interface LocaleInfo {
  /** Locale code as used in your resources (e.g. `'pt-BR'`). */
  code: string;
  /** Name of the language in the language itself (e.g. `'Deutsch'`). */
  nativeName: string;
  /** English name of the language (e.g. `'German'`). */
  englishName: string;
  /** A representative flag emoji. Languages are not countries — this is a UI hint only. */
  flag: string;
  /** Text direction. */
  dir: TextDirection;
}

type Meta = Omit<LocaleInfo, 'code'>;

const m = (nativeName: string, englishName: string, flag: string, dir: TextDirection = 'ltr'): Meta =>
  ({ nativeName, englishName, flag, dir });

/**
 * Metadata for common bot locales, keyed by locale code. Extend or override per call with
 * the `overrides` argument of {@link getLocaleInfo} or `LanguagePicker`'s `labels` prop.
 */
export const LOCALE_INFO: Readonly<Record<string, Meta>> = {
  en: m('English', 'English', '🇬🇧'),
  'en-US': m('English (US)', 'English (US)', '🇺🇸'),
  'en-GB': m('English (UK)', 'English (UK)', '🇬🇧'),
  am: m('አማርኛ', 'Amharic', '🇪🇹'),
  ti: m('ትግርኛ', 'Tigrinya', '🇪🇷'),
  om: m('Afaan Oromoo', 'Oromo', '🇪🇹'),
  so: m('Soomaali', 'Somali', '🇸🇴'),
  ar: m('العربية', 'Arabic', '🇸🇦', 'rtl'),
  fa: m('فارسی', 'Persian', '🇮🇷', 'rtl'),
  he: m('עברית', 'Hebrew', '🇮🇱', 'rtl'),
  ur: m('اردو', 'Urdu', '🇵🇰', 'rtl'),
  bn: m('বাংলা', 'Bengali', '🇧🇩'),
  cs: m('Čeština', 'Czech', '🇨🇿'),
  da: m('Dansk', 'Danish', '🇩🇰'),
  de: m('Deutsch', 'German', '🇩🇪'),
  el: m('Ελληνικά', 'Greek', '🇬🇷'),
  es: m('Español', 'Spanish', '🇪🇸'),
  'es-MX': m('Español (México)', 'Spanish (Mexico)', '🇲🇽'),
  fi: m('Suomi', 'Finnish', '🇫🇮'),
  fr: m('Français', 'French', '🇫🇷'),
  ha: m('Hausa', 'Hausa', '🇳🇬'),
  hi: m('हिन्दी', 'Hindi', '🇮🇳'),
  hu: m('Magyar', 'Hungarian', '🇭🇺'),
  id: m('Bahasa Indonesia', 'Indonesian', '🇮🇩'),
  it: m('Italiano', 'Italian', '🇮🇹'),
  ja: m('日本語', 'Japanese', '🇯🇵'),
  kk: m('Қазақ тілі', 'Kazakh', '🇰🇿'),
  ko: m('한국어', 'Korean', '🇰🇷'),
  ms: m('Bahasa Melayu', 'Malay', '🇲🇾'),
  nb: m('Norsk bokmål', 'Norwegian Bokmål', '🇳🇴'),
  nl: m('Nederlands', 'Dutch', '🇳🇱'),
  pl: m('Polski', 'Polish', '🇵🇱'),
  pt: m('Português', 'Portuguese', '🇵🇹'),
  'pt-BR': m('Português (Brasil)', 'Portuguese (Brazil)', '🇧🇷'),
  'pt-PT': m('Português (Portugal)', 'Portuguese (Portugal)', '🇵🇹'),
  ro: m('Română', 'Romanian', '🇷🇴'),
  ru: m('Русский', 'Russian', '🇷🇺'),
  sv: m('Svenska', 'Swedish', '🇸🇪'),
  sw: m('Kiswahili', 'Swahili', '🇰🇪'),
  th: m('ไทย', 'Thai', '🇹🇭'),
  tr: m('Türkçe', 'Turkish', '🇹🇷'),
  uk: m('Українська', 'Ukrainian', '🇺🇦'),
  uz: m('Oʻzbekcha', 'Uzbek', '🇺🇿'),
  vi: m('Tiếng Việt', 'Vietnamese', '🇻🇳'),
  yo: m('Yorùbá', 'Yoruba', '🇳🇬'),
  zh: m('中文', 'Chinese', '🇨🇳'),
  'zh-Hans': m('简体中文', 'Chinese (Simplified)', '🇨🇳'),
  'zh-Hant': m('繁體中文', 'Chinese (Traditional)', '🇹🇼'),
  'zh-TW': m('繁體中文（台灣）', 'Chinese (Taiwan)', '🇹🇼'),
};

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

/** Text direction for any locale code (`'rtl'` for Arabic, Persian, Hebrew, Urdu, …). */
export function getTextDirection(locale: string): TextDirection {
  const known = LOCALE_INFO[locale]?.dir;
  if (known) return known;
  return RTL_LANGUAGES.has(normalizeLocale(locale).split('-')[0]) ? 'rtl' : 'ltr';
}

function displayName(code: string, inLocale: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([inLocale], { type: 'language' }).of(code);
    return name && name !== code ? name[0].toLocaleUpperCase(inLocale) + name.slice(1) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Display metadata for a locale. Resolves exact codes first (`pt-BR`), then the base
 * language (`pt`), then falls back to `Intl.DisplayNames` and a 🌐 flag.
 *
 * @example
 * getLocaleInfo('ar'); // { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', flag: '🇸🇦', dir: 'rtl' }
 */
export function getLocaleInfo(locale: string, overrides?: Partial<Record<string, Partial<Meta>>>): LocaleInfo {
  const key = detectLocale(locale, Object.keys(LOCALE_INFO));
  const exact = LOCALE_INFO[locale] ?? (key && normalizeLocale(key).toLowerCase() === normalizeLocale(locale).toLowerCase() ? LOCALE_INFO[key] : undefined);
  const base = exact ?? (key ? LOCALE_INFO[key] : undefined);
  const info: LocaleInfo = base
    ? { code: locale, ...base }
    : {
        code: locale,
        nativeName: displayName(locale, locale) ?? locale,
        englishName: displayName(locale, 'en') ?? locale,
        flag: '🌐',
        dir: getTextDirection(locale),
      };
  if (!exact && base) {
    // Regional variant we don't list explicitly (e.g. `es-AR`): keep the base names but
    // prefer a precise native name from Intl when available.
    info.nativeName = displayName(locale, locale) ?? base.nativeName;
    info.englishName = displayName(locale, 'en') ?? base.englishName;
  }
  return { ...info, ...(overrides?.[locale] ?? {}), code: locale };
}
