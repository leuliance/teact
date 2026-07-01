import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { createI18n, useLocale } from '../packages/core/src/runtime/i18n';

const waitForCommit = (ms = 20) => new Promise<void>(r => setTimeout(r, ms));

const enTranslations = {
  greeting: 'Hello',
  farewell: 'Goodbye',
  nested: { deep: 'Deep value' },
};

const amTranslations = {
  greeting: 'ሰላም',
  farewell: 'ደህና ሁን',
  nested: { deep: 'ጥልቅ ዋጋ' },
};

const i18n = createI18n({
  defaultLocale: 'en',
  resources: {
    en: { translation: enTranslations },
    am: { translation: amTranslations },
  },
});

describe('createI18n', () => {
  test('creates a Provider component', () => {
    expect(i18n.Provider).toBeDefined();
    expect(typeof i18n.Provider).toBe('function');
  });

  test('creates an i18next instance', () => {
    expect(i18n.instance).toBeDefined();
    expect(i18n.instance.language).toBe('en');
  });

  test('instance has the configured resources', () => {
    const t = i18n.instance.getFixedT('en');
    expect(t('greeting')).toBe('Hello');
  });

  test('instance supports multiple locales', () => {
    const tEn = i18n.instance.getFixedT('en');
    const tAm = i18n.instance.getFixedT('am');
    expect(tEn('greeting')).toBe('Hello');
    expect(tAm('greeting')).toBe('ሰላም');
  });

  test('instance handles nested keys', () => {
    const t = i18n.instance.getFixedT('en');
    expect(t('nested.deep')).toBe('Deep value');
  });
});

describe('useLocale', () => {
  test('returns t function and current locale', async () => {
    let locale: string = '';
    let translated: string = '';

    function TestComp() {
      const { t, locale: l } = useLocale();
      locale = l;
      translated = t('greeting');
      return React.createElement('tg-message', { text: translated });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit();

    expect(locale).toBe('en');
    expect(translated).toBe('Hello');
    expect(output!.props.text).toBe('Hello');
  });

  test('returns setLocale function', async () => {
    let setLocaleFn: ((lng: string) => void) | null = null;

    function TestComp() {
      const { setLocale } = useLocale();
      setLocaleFn = setLocale;
      return React.createElement('tg-message', { text: 'test' });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit();

    expect(setLocaleFn).toBeDefined();
    expect(typeof setLocaleFn).toBe('function');
  });

  test('returns availableLocales array', async () => {
    let locales: string[] = [];

    function TestComp() {
      const { availableLocales } = useLocale();
      locales = availableLocales;
      return React.createElement('tg-message', { text: 'test' });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit();

    expect(locales).toContain('en');
    expect(locales).toContain('am');
    expect(locales).toHaveLength(2);
  });

  test('t() returns correct translation for default locale', async () => {
    let farewell: string = '';

    function TestComp() {
      const { t } = useLocale();
      farewell = t('farewell');
      return React.createElement('tg-message', { text: farewell });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit();

    expect(farewell).toBe('Goodbye');
  });

  test('t() handles nested keys', async () => {
    let deepVal: string = '';

    function TestComp() {
      const { t } = useLocale();
      deepVal = t('nested.deep');
      return React.createElement('tg-message', { text: deepVal });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit();

    expect(deepVal).toBe('Deep value');
  });

  test('locale switching triggers re-render with new translations', async () => {
    const outputs: string[] = [];

    function TestComp() {
      const { t, locale, setLocale } = useLocale();
      const text = t('greeting');
      outputs.push(text);

      React.useEffect(() => {
        if (locale === 'en') {
          setLocale('am');
        }
      }, [locale, setLocale]);

      return React.createElement('tg-message', { text });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit(50);

    expect(outputs.length).toBeGreaterThanOrEqual(2);
    expect(outputs[0]).toBe('Hello');
    const lastOutput = outputs[outputs.length - 1];
    expect(lastOutput).toBe('ሰላም');
  });

  test('t() returns key as fallback for missing translation', async () => {
    let missing: string = '';

    function TestComp() {
      const { t } = useLocale();
      missing = t('nonexistent.key');
      return React.createElement('tg-message', { text: missing });
    }

    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      React.createElement(i18n.Provider, null, React.createElement(TestComp)),
    );
    await waitForCommit();

    expect(missing).toBe('nonexistent.key');
  });
});

describe('createI18n with fallback', () => {
  test('uses fallbackLocale for missing keys', () => {
    const partial = createI18n({
      defaultLocale: 'fr',
      fallbackLocale: 'en',
      resources: {
        en: { translation: { greeting: 'Hello', only_en: 'English only' } },
        fr: { translation: { greeting: 'Bonjour' } },
      },
    });

    const t = partial.instance.getFixedT('fr');
    expect(t('greeting')).toBe('Bonjour');
    expect(t('only_en')).toBe('English only');
  });
});
