import { useMemo } from 'react';
import { useLocale } from '@teactjs/core';

/** Options shared by every formatter created with {@link createFormatter} / {@link useFormat}. */
export interface FormatOptions {
  /** IANA time zone for `date` / `time` (e.g. `'Africa/Addis_Ababa'`). Defaults to the runtime's zone. */
  timeZone?: string;
  /** Default ISO 4217 currency for `currency()` when none is passed. Default `'USD'`. */
  currency?: string;
}

/** Plural forms keyed by `Intl.PluralRules` category. `other` is required. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** Locale-bound formatting helpers, all built on `Intl`. */
export interface Formatter {
  /** The locale these helpers format for. */
  locale: string;
  /** `1234.5` → `"1,234.5"` (en) / `"1.234,5"` (de). */
  number: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  /** `currency(9.99, 'EUR')` → `"€9.99"` (en) / `"9,99 €"` (de). */
  currency: (value: number, currency?: string, options?: Intl.NumberFormatOptions) => string;
  /** Fractions: `percent(0.25)` → `"25%"`. */
  percent: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Date only. Default `{ dateStyle: 'medium' }`. */
  date: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  /** Time only. Default `{ timeStyle: 'short' }`. */
  time: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  /** Date and time. Default `{ dateStyle: 'medium', timeStyle: 'short' }`. */
  dateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  /**
   * Relative time. Either an explicit amount + unit (`relativeTime(-1, 'day')` → `"yesterday"`)
   * or a date, for which the best unit is picked relative to now (`relativeTime(someDate)` →
   * `"in 3 hours"`). Uses `numeric: 'auto'` by default.
   */
  relativeTime: (
    value: number | Date,
    unit?: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ) => string;
  /** `list(['a', 'b', 'c'])` → `"a, b, and c"` (en) / `"a, b und c"` (de). */
  list: (items: Iterable<string>, options?: Intl.ListFormatOptions) => string;
  /**
   * Choose a plural form with `Intl.PluralRules` and substitute `{{count}}` (formatted for the
   * locale). Falls back to `other` when a category is missing.
   *
   * @example
   * plural(3, { one: '{{count}} item', other: '{{count}} items' }); // "3 items"
   */
  plural: (count: number, forms: PluralForms, options?: Intl.PluralRulesOptions) => string;
  /** The raw plural category for a number (`'one'`, `'few'`, `'many'`, `'other'`, …). */
  pluralCategory: (count: number, options?: Intl.PluralRulesOptions) => Intl.LDMLPluralRule;
}

const toDate = (v: Date | number | string): Date => (v instanceof Date ? v : new Date(v));

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/**
 * Create locale-bound formatting helpers without React (e.g. in command handlers or
 * middleware). Inside components prefer {@link useFormat}.
 *
 * @example
 * const f = createFormatter('de');
 * f.number(1234.5);          // "1.234,5"
 * f.currency(5, 'EUR');      // "5,00 €"
 */
export function createFormatter(locale: string, defaults: FormatOptions = {}): Formatter {
  const tz = defaults.timeZone ? { timeZone: defaults.timeZone } : {};
  const number = (value: number | bigint, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, options).format(value);

  return {
    locale,
    number,
    currency: (value, currency = defaults.currency ?? 'USD', options) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency, ...options }).format(value),
    percent: (value, options) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2, ...options }).format(value),
    date: (value, options) =>
      new Intl.DateTimeFormat(locale, { ...tz, ...(options ?? { dateStyle: 'medium' }) }).format(toDate(value)),
    time: (value, options) =>
      new Intl.DateTimeFormat(locale, { ...tz, ...(options ?? { timeStyle: 'short' }) }).format(toDate(value)),
    dateTime: (value, options) =>
      new Intl.DateTimeFormat(locale, { ...tz, ...(options ?? { dateStyle: 'medium', timeStyle: 'short' }) }).format(toDate(value)),
    relativeTime: (value, unit, options) => {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', ...options });
      if (typeof value === 'number') return rtf.format(value, unit ?? 'second');
      const diffSec = (value.getTime() - Date.now()) / 1000;
      if (unit) {
        const size = RELATIVE_UNITS.find(([u]) => u === unit || `${u}s` === unit)?.[1] ?? 1;
        return rtf.format(Math.round(diffSec / size), unit);
      }
      for (const [u, size] of RELATIVE_UNITS) {
        if (Math.abs(diffSec) >= size || u === 'second') return rtf.format(Math.round(diffSec / size), u);
      }
      return rtf.format(0, 'second');
    },
    list: (items, options) => new Intl.ListFormat(locale, options).format(items),
    pluralCategory: (count, options) => new Intl.PluralRules(locale, options).select(count),
    plural: (count, forms, options) => {
      const category = new Intl.PluralRules(locale, options).select(count);
      const template = forms[category] ?? forms.other;
      return template.replace(/\{\{\s*count\s*\}\}/g, number(count));
    },
  };
}

/**
 * Formatting helpers bound to the current chat's locale (from `useLocale()`).
 *
 * @example
 * function Order({ total, items, placedAt }: Props) {
 *   const f = useFormat();
 *   return (
 *     <Message
 *       text={`${f.plural(items, { one: '{{count}} item', other: '{{count}} items' })} · ` +
 *         `${f.currency(total, 'EUR')} · ${f.relativeTime(placedAt)}`}
 *     />
 *   );
 * }
 */
export function useFormat(options: FormatOptions = {}): Formatter {
  const { locale } = useLocale();
  return useMemo(
    () => createFormatter(locale, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, options.timeZone, options.currency],
  );
}
