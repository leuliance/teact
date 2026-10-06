import React from 'react';
import type { TeactPlugin, I18nInstance, I18nLocaleResource } from '@teactjs/core';
import { createI18n, detectLocale } from '@teactjs/core';
import { packs as builtinPacks, type TeactMessages } from './locales';

/** Namespace-free key prefix under which built-in packs are merged: `t('teact.cancel')`. */
export const PACK_KEY = 'teact';

/** Options for {@link i18nPlugin}. */
export interface I18nPluginOptions {
  /**
   * Translations keyed by locale — plain objects (shorthand for i18next's
   * `{ translation: {...} }`). Use this **or** `resources`.
   */
  locales?: Record<string, Record<string, any>>;
  /** i18next-style resources (`{ en: { translation: {...} } }`). Merged with `locales`. */
  resources?: Record<string, I18nLocaleResource>;
  /** Locale used when nothing is persisted or detected. Default: `'en'` if present, else the first locale. */
  defaultLocale?: string;
  /** Locale used for missing keys. Default: `defaultLocale`. */
  fallbackLocale?: string;
  /** Detect the user's Telegram `language_code`. Default `true`. */
  detect?: boolean;
  /** Persist the chosen locale in the chat session (`__locale`). Default `true`. */
  persist?: boolean;
  /** Session key for the persisted locale. Default `'__locale'`. */
  sessionKey?: string;
  /**
   * Built-in UI string packs (`t('teact.cancel')`, `t('teact.pageOf', { page, total })`, …).
   * - `true` (default): merge the built-in pack into each of your locales.
   * - `false`: no packs.
   * - an object: extra/override packs keyed by locale, merged over the built-in ones.
   *
   * Your own `teact.*` keys always win. If you pass no locales at all, every built-in
   * pack locale becomes available.
   */
  packs?: boolean | Record<string, Partial<TeactMessages> & Record<string, string>>;
  /** Called when a chat switches language. */
  onLocaleChange?: (locale: string, previous: string) => void;
}

/** The plugin returned by {@link i18nPlugin}; also exposes the underlying i18n instance. */
export type I18nPlugin = TeactPlugin & { i18n: I18nInstance };

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge where `over` wins; neither input is mutated. */
function deepMerge(under: Record<string, any>, over: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...under };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * Build the final i18next resources: user resources + built-in packs under `teact.*`,
 * never overwriting a key the user defined.
 */
export function buildResources(options: Pick<I18nPluginOptions, 'locales' | 'resources' | 'packs'>): Record<string, I18nLocaleResource> {
  const resources: Record<string, I18nLocaleResource> = {};
  for (const [code, res] of Object.entries(options.resources ?? {})) {
    resources[code] = deepMerge({}, res) as I18nLocaleResource;
  }
  for (const [code, translation] of Object.entries(options.locales ?? {})) {
    const existing = resources[code] ?? { translation: {} };
    resources[code] = { ...existing, translation: deepMerge(existing.translation ?? {}, translation) };
  }

  const packsOpt = options.packs ?? true;
  if (packsOpt === false) return resources;

  const custom = isPlainObject(packsOpt) ? packsOpt : {};
  const allPacks: Record<string, Record<string, string>> = { ...builtinPacks };
  for (const [code, pack] of Object.entries(custom)) {
    allPacks[code] = { ...(allPacks[code] ?? {}), ...(pack as Record<string, string>) };
  }

  const targetLocales = Object.keys(resources).length ? Object.keys(resources) : Object.keys(allPacks);
  const packCodes = Object.keys(allPacks);
  for (const code of targetLocales) {
    const packCode = detectLocale(code, packCodes);
    if (!packCode) continue;
    const res = resources[code] ?? { translation: {} };
    const translation = res.translation ?? {};
    const userPack = isPlainObject(translation[PACK_KEY]) ? translation[PACK_KEY] : {};
    resources[code] = {
      ...res,
      translation: { ...translation, [PACK_KEY]: deepMerge(allPacks[packCode], userPack) },
    };
  }
  return resources;
}

/**
 * Add internationalization via `plugins: [...]`.
 *
 * Wraps the app in core's `createI18n` Provider: the chat's locale is restored from the
 * session, else detected from Telegram's `language_code`, else `defaultLocale`; switching
 * with `setLocale` (or `<LanguagePicker />`) is persisted to the session.
 *
 * @example
 * // teact.config.ts
 * import { defineConfig } from '@teactjs/core';
 * import { i18nPlugin } from '@teactjs/i18n';
 * import en from './locales/en.json';
 * import am from './locales/am.json';
 *
 * export default defineConfig({
 *   plugins: [i18nPlugin({ locales: { en, am }, defaultLocale: 'en' })],
 * });
 */
export function i18nPlugin(options: I18nPluginOptions): I18nPlugin {
  const resources = buildResources(options);
  const codes = Object.keys(resources);
  if (codes.length === 0) {
    throw new Error('[teact] i18nPlugin: pass `locales` or `resources` (or leave `packs` enabled).');
  }
  const defaultLocale =
    (options.defaultLocale && detectLocale(options.defaultLocale, codes)) ??
    (codes.includes('en') ? 'en' : codes[0]);
  if (options.defaultLocale && !codes.includes(options.defaultLocale)) {
    console.warn(
      `[teact] i18nPlugin: defaultLocale "${options.defaultLocale}" has no resources; using "${defaultLocale}".`,
    );
  }

  const i18n = createI18n({
    defaultLocale,
    fallbackLocale: options.fallbackLocale,
    resources,
    detect: options.detect,
    persist: options.persist,
    sessionKey: options.sessionKey,
    onLocaleChange: options.onLocaleChange,
  });

  const Provider = ({ children }: { children: React.ReactNode }) =>
    React.createElement(i18n.Provider, null, children);

  return {
    name: 'i18n',
    Provider,
    services: { i18n: i18n.instance },
    i18n,
  };
}
