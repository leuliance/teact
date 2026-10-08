import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, MemorySessionStore, LOCALE_SESSION_KEY, useService } from '../packages/core/src';
import type { BotContext, OutputNode } from '../packages/core/src/renderer';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import {
  i18nPlugin,
  buildResources,
  LanguagePicker,
  useFormat,
  createFormatter,
  useT,
  useLocale,
  useLocaleInfo,
  defineLocales,
  getLocaleInfo,
  getTextDirection,
  localeCallbackData,
  packs,
  packLocales,
} from '../packages/i18n/src';
import { en as enPack } from '../packages/i18n/src/locales';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** MockAdapter without language_code support → dispatch grammY-shaped contexts ourselves. */
class LangAdapter extends MockAdapter {
  private hs = new Map<string, Array<(ctx: BotContext) => void | Promise<void>>>();
  private n = 900;
  override on(event: string, handler: (ctx: BotContext) => void | Promise<void>): void {
    super.on(event, handler);
    if (!this.hs.has(event)) this.hs.set(event, []);
    this.hs.get(event)!.push(handler);
  }
  private async fire(event: string, ctx: BotContext) {
    for (const h of this.hs.get(event) ?? []) await h(ctx);
  }
  message(chatId: string, text: string, lang?: string) {
    return this.fire('message', mk(chatId, { text, messageId: String(this.n++) }, lang));
  }
  callback(chatId: string, data: string, lang?: string) {
    return this.fire('callback_query', mk(chatId, { callbackData: data, messageId: '1' }, lang));
  }
}

function mk(chatId: string, extra: Partial<BotContext>, lang?: string): BotContext {
  return {
    chatId,
    userId: chatId,
    platform: 'mock',
    user: { id: chatId, firstName: 'T', platform: 'mock' },
    raw: { from: { id: Number(chatId), is_bot: false, first_name: 'T', language_code: lang } },
    ...extra,
  };
}

function latest(adapter: MockAdapter): OutputNode | undefined {
  const s = adapter.getLastSent();
  const e = adapter.getLastEdited();
  if (e && (!s || e.timestamp >= s.timestamp)) return e.output;
  return s?.output;
}

function buttons(node: OutputNode, out: string[] = []): string[] {
  if (node.type === 'tg-button') out.push(node.props.text);
  for (const c of node.children) buttons(c, out);
  return out;
}

function callbackFor(node: OutputNode, label: string): string | undefined {
  if (node.type === 'tg-button' && String(node.props.text).includes(label)) return node.props.callbackData;
  for (const c of node.children) {
    const hit = callbackFor(c, label);
    if (hit) return hit;
  }
  return undefined;
}

const en = { greeting: 'Hello', teact: { cancel: 'Nope' } };
const am = { greeting: 'ሰላም' };
const de = { greeting: 'Hallo' };

async function start(component: React.FC, opts: Parameters<typeof i18nPlugin>[0], store?: MemorySessionStore) {
  const adapter = new LangAdapter();
  const plugin = i18nPlugin(opts);
  const bot = createBot({
    component,
    adapter,
    token: 'test',
    plugins: [plugin],
    session: store ? { store } : undefined,
  });
  await bot.start();
  return { adapter, bot, plugin };
}

describe('built-in locale packs', () => {
  const required = ['en', 'am', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sw', 'tr', 'uk', 'zh'];
  const enKeys = Object.keys(enPack).sort();
  const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();

  test('ships every required locale', () => {
    for (const code of required) expect(packLocales).toContain(code as any);
  });

  for (const [code, pack] of Object.entries(packs)) {
    test(`${code}: has every key of en, no extras, no empty strings, same placeholders`, () => {
      expect(Object.keys(pack).sort()).toEqual(enKeys);
      for (const key of enKeys) {
        const value = (pack as Record<string, string>)[key];
        expect(typeof value).toBe('string');
        expect(value.trim().length).toBeGreaterThan(0);
        expect(placeholders(value)).toEqual(placeholders((enPack as Record<string, string>)[key]));
      }
    });
  }
});

describe('buildResources', () => {
  test('merges packs under teact.* without overriding user keys or adding locales', () => {
    const res = buildResources({ locales: { en, am } });
    expect(Object.keys(res)).toEqual(['en', 'am']);
    expect(res.en.translation.greeting).toBe('Hello');
    expect(res.en.translation.teact.cancel).toBe('Nope'); // user wins
    expect(res.en.translation.teact.back).toBe('Back');
    expect(res.am.translation.teact.cancel).toBe(packs.am.cancel);
  });

  test('regional locales get the base pack; packs: false disables; custom packs override', () => {
    expect(buildResources({ locales: { 'pt-BR': { a: 'b' } } })['pt-BR'].translation.teact.yes).toBe('Sim');
    expect(buildResources({ locales: { en }, packs: false }).en.translation.teact).toEqual({ cancel: 'Nope' });
    const custom = buildResources({ locales: { de }, packs: { de: { done: 'Erledigt' } } });
    expect(custom.de.translation.teact.done).toBe('Erledigt');
    expect(custom.de.translation.teact.cancel).toBe('Abbrechen');
  });

  test('accepts i18next resources and falls back to every pack when no locales are given', () => {
    const res = buildResources({ resources: { fr: { translation: { x: 'y' } } } });
    expect(res.fr.translation.teact.cancel).toBe('Annuler');
    expect(Object.keys(buildResources({})).sort()).toEqual([...packLocales].sort());
  });
});

function Greeting() {
  const { t, locale } = useLocale();
  return <Message text={`${t('greeting')}|${t('teact.cancel')}|${locale}`} />;
}

describe('i18nPlugin', () => {
  test('registers through plugins, detects language_code and exposes the i18next service', async () => {
    let service: unknown;
    function App() {
      service = useService('i18n' as any);
      return <Greeting />;
    }
    const { adapter, bot, plugin } = await start(App, { locales: { en, am } });
    expect(plugin.name).toBe('teact-i18n');
    await adapter.message('1', 'hi', 'am');
    await wait();
    expect(latest(adapter)!.props.text).toBe(`ሰላም|${packs.am.cancel}|am`);
    expect(service).toBe(plugin.i18n.instance);

    await adapter.message('2', 'hi', 'de-AT');
    await wait();
    expect(latest(adapter)!.props.text).toBe('Hello|Nope|en');
    await bot.stop();
  });

  test('persists the choice across a bot restart with a shared session store', async () => {
    const store = new MemorySessionStore();
    const opts = { locales: { en, am, de } };
    const first = await start(Greeting, opts, store);
    await first.adapter.callback('3', localeCallbackData('de'), 'en');
    await wait();
    expect(latest(first.adapter)!.props.text).toBe('Hallo|Abbrechen|de');
    expect((await store.get('mock:3'))?.[LOCALE_SESSION_KEY]).toBe('de');
    await first.bot.stop();

    const second = await start(Greeting, opts, store);
    await second.adapter.message('3', 'hello again', 'am');
    await wait();
    expect(latest(second.adapter)!.props.text).toBe('Hallo|Abbrechen|de');
    await second.bot.stop();
  });

  test('defaultLocale and detect: false', async () => {
    const { adapter, bot } = await start(Greeting, { locales: { en, de }, defaultLocale: 'de', detect: false });
    await adapter.message('4', 'hi', 'en');
    await wait();
    expect(latest(adapter)!.props.text).toBe('Hallo|Abbrechen|de');
    await bot.stop();
  });
});

describe('LanguagePicker', () => {
  test('lists locales with flags and native names and marks the current one', async () => {
    const { adapter, bot } = await start(() => <LanguagePicker columns={3} />, { locales: { en, am, de } });
    await adapter.message('5', 'hi', 'am');
    await wait();
    const out = latest(adapter)!;
    expect(out.props.text).toBe(packs.am.selectLanguage);
    expect(buttons(out)).toEqual(['🇬🇧 English', '✓ 🇪🇹 አማርኛ', '🇩🇪 Deutsch']);
    const rows = out.children.find((c) => c.type === 'tg-keyboard')!.children;
    expect(rows).toHaveLength(1);
    expect(rows[0].children).toHaveLength(3);
    await bot.stop();
  });

  test('pressing a button switches, persists and calls onChange', async () => {
    const changes: string[] = [];
    const store = new MemorySessionStore();
    function Picker() {
      return <LanguagePicker title="Lang?" onChange={(l) => changes.push(l)} />;
    }
    const { adapter, bot } = await start(Picker, { locales: { en, am, de } }, store);
    await adapter.message('6', 'hi', 'en');
    await wait();
    expect(changes).toEqual([]);
    const first = latest(adapter)!;
    expect(first.props.text).toBe('Lang?');
    expect(buttons(first)[0]).toBe('✓ 🇬🇧 English');

    const data = callbackFor(first, 'Deutsch')!;
    expect(data).toBe(localeCallbackData('de'));
    await adapter.callback('6', data, 'en');
    await wait();
    expect(buttons(latest(adapter)!)).toEqual(['🇬🇧 English', '🇪🇹 አማርኛ', '✓ 🇩🇪 Deutsch']);
    expect(changes).toEqual(['de']);
    expect((await store.get('mock:6'))?.[LOCALE_SESSION_KEY]).toBe('de');
    await bot.stop();
  });

  test('locales subset, labels override and keyboardOnly', async () => {
    function App() {
      return (
        <Message text="settings">
          <LanguagePicker keyboardOnly locales={['de', 'en']} showFlags={false} labels={{ de: { nativeName: 'DE' } }} />
        </Message>
      );
    }
    const { adapter, bot } = await start(App, { locales: { en, am, de } });
    await adapter.message('7', 'hi', 'en');
    await wait();
    expect(latest(adapter)!.props.text).toBe('settings');
    expect(buttons(latest(adapter)!)).toEqual(['DE', '✓ English']);
    await bot.stop();
  });
});

describe('formatting', () => {
  test('createFormatter: numbers, currency, percent, lists', () => {
    const e = createFormatter('en');
    const d = createFormatter('de');
    expect(e.number(1234.5)).toBe('1,234.5');
    expect(d.number(1234.5)).toBe('1.234,5');
    expect(e.currency(9.99, 'EUR')).toBe('€9.99');
    expect(d.currency(9.99, 'EUR')).toBe('9,99 €');
    expect(createFormatter('en', { currency: 'USD' }).currency(5)).toBe('$5.00');
    expect(e.percent(0.25)).toBe('25%');
    expect(e.list(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(d.list(['a', 'b', 'c'])).toBe('a, b und c');
    expect(e.list(['a', 'b'], { type: 'disjunction' })).toBe('a or b');
  });

  test('createFormatter: dates, times and relative time', () => {
    const when = Date.UTC(2026, 0, 15, 14, 30);
    const e = createFormatter('en', { timeZone: 'UTC' });
    expect(e.date(when)).toBe('Jan 15, 2026');
    expect(e.time(when)).toMatch(/^2:30\sPM$/); // ICU versions differ on the space
    expect(createFormatter('de', { timeZone: 'UTC' }).date(when, { dateStyle: 'long' })).toBe('15. Januar 2026');
    expect(e.relativeTime(-1, 'day')).toBe('yesterday');
    expect(createFormatter('fr').relativeTime(2, 'hour')).toBe('dans 2 heures');
    expect(e.relativeTime(new Date(Date.now() + 3 * 3600 * 1000 + 5000))).toBe('in 3 hours');
    expect(e.relativeTime(new Date(Date.now() - 2 * 24 * 3600 * 1000))).toBe('2 days ago');
  });

  test('plural uses Intl.PluralRules per locale', () => {
    const forms = { one: '{{count}} file', other: '{{count}} files' };
    expect(createFormatter('en').plural(1, forms)).toBe('1 file');
    expect(createFormatter('en').plural(1200, forms)).toBe('1,200 files');
    const ru = createFormatter('ru');
    const ruForms = { one: '{{count}} файл', few: '{{count}} файла', many: '{{count}} файлов', other: '{{count}} файла' };
    expect(ru.plural(1, ruForms)).toBe('1 файл');
    expect(ru.plural(3, ruForms)).toBe('3 файла');
    expect(ru.plural(5, ruForms)).toBe('5 файлов');
    expect(ru.pluralCategory(21)).toBe('one');
    expect(createFormatter('ar').pluralCategory(2)).toBe('two');
  });

  test('useFormat is bound to the chat locale', async () => {
    function App() {
      const f = useFormat();
      const info = useLocaleInfo();
      return <Message text={`${f.number(1234.5)}|${f.percent(0.5)}|${info.dir}|${info.englishName}`} />;
    }
    const { adapter, bot } = await start(App, { locales: { en, de, ar: { greeting: 'مرحبا' } } });
    await adapter.message('8', 'hi', 'de');
    await wait();
    expect(latest(adapter)!.props.text).toBe('1.234,5|50 %|ltr|German');
    await adapter.message('9', 'hi', 'ar');
    await wait();
    expect(latest(adapter)!.props.text).toBe(`${createFormatter('ar').number(1234.5)}|${createFormatter('ar').percent(0.5)}|rtl|Arabic`);
    await bot.stop();
  });
});

describe('locale metadata', () => {
  test('rtl languages', () => {
    for (const code of ['ar', 'fa', 'he', 'ur', 'ar-EG']) expect(getTextDirection(code)).toBe('rtl');
    for (const code of ['en', 'am', 'zh', 'ja']) expect(getTextDirection(code)).toBe('ltr');
  });

  test('every shipped pack locale has metadata', () => {
    for (const code of packLocales) {
      const info = getLocaleInfo(code);
      expect(info.flag).not.toBe('🌐');
      expect(info.nativeName.length).toBeGreaterThan(0);
    }
  });

  test('regional and unknown codes', () => {
    expect(getLocaleInfo('pt-BR')).toMatchObject({ code: 'pt-BR', flag: '🇧🇷', englishName: 'Portuguese (Brazil)' });
    expect(getLocaleInfo('es-AR')).toMatchObject({ code: 'es-AR', flag: '🇪🇸', englishName: 'Spanish (Argentina)' });
    const unknown = getLocaleInfo('xx');
    expect(unknown.flag).toBe('🌐');
    expect(unknown.dir).toBe('ltr');
    expect(getLocaleInfo('sw', { sw: { flag: '🇹🇿' } }).flag).toBe('🇹🇿');
  });
});

describe('typed helpers', () => {
  test('defineLocales type-checks keys and returns the locales unchanged', () => {
    const base = { hello: 'Hello', menu: { title: 'Menu' } };
    const locales = defineLocales<typeof base>()({
      en: base,
      am: { hello: 'ሰላም', menu: { title: 'ምናሌ' } },
    });
    expect(locales.am.menu.title).toBe('ምናሌ');

    // Compile-time checks (validated by `tsc --noEmit`).
    defineLocales<typeof base>()({
      // @ts-expect-error — missing `menu`
      fr: { hello: 'Bonjour' },
    });
    defineLocales<typeof base>()({
      // @ts-expect-error — unknown key `extra`
      de: { hello: 'Hallo', menu: { title: 'Menü' }, extra: 'x' },
    });
  });

  test('useT<T>() returns a key-checked t', async () => {
    const base = { greeting: 'Hello', nested: { deep: 'Deep' } };
    let out = '';
    function App() {
      const t = useT<typeof base>();
      out = `${t('greeting')}|${t('nested.deep')}|${t('teact.yes')}`;
      // @ts-expect-error — not a key of base
      void (() => t('nested.missing'));
      return <Message text={out} />;
    }
    const { adapter, bot } = await start(App, { locales: { en: base } });
    await adapter.message('10', 'hi', 'en');
    await wait();
    expect(out).toBe('Hello|Deep|Yes');
    await bot.stop();
  });
});
