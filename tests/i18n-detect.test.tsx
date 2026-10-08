import { describe, test, expect, spyOn } from 'bun:test';
import React from 'react';
import {
  createBot,
  createI18n,
  useLocale,
  detectLocale,
  normalizeLocale,
  getUserLanguageCode,
  localeCallbackData,
  MemorySessionStore,
  LOCALE_SESSION_KEY,
} from '../packages/core/src';
import type { BotContext, OutputNode } from '../packages/core/src/renderer';
import { Message, Button, InlineKeyboard } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/**
 * MockAdapter does not put a `language_code` on its contexts, so capture the
 * registered handlers and dispatch contexts with a grammY-shaped `raw.from`.
 */
class LangAdapter extends MockAdapter {
  private handlersByEvent = new Map<string, Array<(ctx: BotContext) => void | Promise<void>>>();
  private nextIn = 500;

  override on(event: string, handler: (ctx: BotContext) => void | Promise<void>): void {
    super.on(event, handler);
    if (!this.handlersByEvent.has(event)) this.handlersByEvent.set(event, []);
    this.handlersByEvent.get(event)!.push(handler);
  }

  private async dispatch(event: string, ctx: BotContext) {
    for (const h of this.handlersByEvent.get(event) ?? []) await h(ctx);
  }

  message(chatId: string, text: string, languageCode?: string) {
    return this.dispatch('message', ctx(chatId, { text, messageId: String(this.nextIn++) }, languageCode));
  }

  callback(chatId: string, data: string, languageCode?: string) {
    return this.dispatch('callback_query', ctx(chatId, { callbackData: data, messageId: '1' }, languageCode));
  }
}

function ctx(chatId: string, extra: Partial<BotContext>, languageCode?: string): BotContext {
  return {
    chatId,
    userId: chatId,
    platform: 'mock',
    user: { id: chatId, firstName: 'Test', platform: 'mock' },
    raw: { from: { id: Number(chatId), is_bot: false, first_name: 'Test', language_code: languageCode } },
    ...extra,
  };
}

const resources = {
  en: { translation: { hello: 'Hello' } },
  am: { translation: { hello: 'ሰላም' } },
  pt: { translation: { hello: 'Olá' } },
  'zh-Hant': { translation: { hello: '你好（繁體）' } },
};

function lastText(adapter: MockAdapter): string | undefined {
  const sent = adapter.getLastSent();
  const edited = adapter.getLastEdited();
  if (edited && (!sent || edited.timestamp >= sent.timestamp)) return edited.output.props.text;
  return sent?.output.props.text;
}

function findButtons(node: OutputNode, out: OutputNode[] = []): OutputNode[] {
  if (node.type === 'tg-button') out.push(node);
  for (const c of node.children) findButtons(c, out);
  return out;
}

describe('normalizeLocale / detectLocale', () => {
  test('normalizes casing and separators', () => {
    expect(normalizeLocale('pt-br')).toBe('pt-BR');
    expect(normalizeLocale('EN_us')).toBe('en-US');
    expect(normalizeLocale('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(normalizeLocale('es-419')).toBe('es-419');
    expect(normalizeLocale(undefined)).toBe('');
  });

  test('matches exact, regional and base languages', () => {
    expect(detectLocale('pt-br', ['en', 'pt-BR', 'pt'])).toBe('pt-BR');
    expect(detectLocale('pt-br', ['en', 'pt'])).toBe('pt');
    expect(detectLocale('pt', ['en', 'pt-BR'])).toBe('pt-BR');
    expect(detectLocale('EN', ['en'])).toBe('en');
    expect(detectLocale('zh-hant-tw', ['en', 'zh-Hant'])).toBe('zh-Hant');
    expect(detectLocale('en_US', ['en-us'])).toBe('en-us');
  });

  test('returns undefined when nothing matches', () => {
    expect(detectLocale('xx', ['en'])).toBeUndefined();
    expect(detectLocale(undefined, ['en'])).toBeUndefined();
    expect(detectLocale('en', [])).toBeUndefined();
  });

  test('getUserLanguageCode reads grammY ctx, raw updates and user.languageCode', () => {
    expect(getUserLanguageCode(ctx('1', {}, 'de'))).toBe('de');
    expect(getUserLanguageCode({ ...ctx('1', {}), raw: { callback_query: { from: { language_code: 'fr' } } } })).toBe('fr');
    expect(getUserLanguageCode({ ...ctx('1', {}), raw: {}, user: { id: '1', platform: 'x', languageCode: 'es' } as any })).toBe('es');
    expect(getUserLanguageCode({ ...ctx('1', {}), raw: undefined })).toBeUndefined();
  });

  test('createI18n exposes availableLocales and resolveLocale', () => {
    const i18n = createI18n({ defaultLocale: 'en', resources });
    expect(i18n.availableLocales).toEqual(['en', 'am', 'pt', 'zh-Hant']);
    expect(i18n.resolveLocale('ZH-hant')).toBe('zh-Hant');
    expect(i18n.resolveLocale('xx')).toBeUndefined();
  });
});

function Hello() {
  const { t, locale } = useLocale();
  return <Message text={`${t('hello')}|${locale}`} />;
}

async function startBot(opts: {
  store?: MemorySessionStore;
  detect?: boolean;
  persist?: boolean;
  component?: React.FC;
}) {
  const adapter = new LangAdapter();
  const i18n = createI18n({ defaultLocale: 'en', resources, detect: opts.detect, persist: opts.persist });
  const bot = createBot({
    component: opts.component ?? Hello,
    adapter,
    token: 'test',
    providers: i18n.Provider,
    session: opts.store ? { store: opts.store } : undefined,
  });
  await bot.start();
  return { adapter, bot };
}

describe('locale detection from Telegram language_code', () => {
  test('uses the user language when available', async () => {
    const { adapter, bot } = await startBot({});
    await adapter.message('1', 'hi', 'am');
    await wait();
    expect(lastText(adapter)).toBe('ሰላም|am');
    await bot.stop();
  });

  test('pt-br falls back to the base language pt', async () => {
    const { adapter, bot } = await startBot({});
    await adapter.message('2', 'hi', 'pt-br');
    await wait();
    expect(lastText(adapter)).toBe('Olá|pt');
    await bot.stop();
  });

  test('unknown language falls back to defaultLocale', async () => {
    const { adapter, bot } = await startBot({});
    await adapter.message('3', 'hi', 'xx');
    await wait();
    expect(lastText(adapter)).toBe('Hello|en');
    await bot.stop();
  });

  test('detect: false ignores the user language', async () => {
    const { adapter, bot } = await startBot({ detect: false });
    await adapter.message('4', 'hi', 'am');
    await wait();
    expect(lastText(adapter)).toBe('Hello|en');
    await bot.stop();
  });
});

function Switcher() {
  const { t, locale, setLocale } = useLocale();
  return (
    <Message text={`${t('hello')}|${locale}`}>
      <InlineKeyboard>
        <Button text="am" onClick={() => setLocale('am')} />
        <Button text="bogus" onClick={() => setLocale('klingon')} />
        <Button text="pt" onClick={localeCallbackData('pt')} />
      </InlineKeyboard>
    </Message>
  );
}

describe('locale persistence', () => {
  test('setLocale persists to the session and survives a restart', async () => {
    const store = new MemorySessionStore();
    const first = await startBot({ store, component: Switcher });
    await first.adapter.message('10', 'hi', 'en');
    await wait();
    expect(lastText(first.adapter)).toBe('Hello|en');

    const amBtn = findButtons(first.adapter.getLastSent()!.output).find((b) => b.props.text === 'am')!;
    await first.adapter.callback('10', amBtn.props.callbackData, 'en');
    await wait();
    expect(lastText(first.adapter)).toBe('ሰላም|am');
    expect((await store.get('mock:10'))?.[LOCALE_SESSION_KEY]).toBe('am');
    await first.bot.stop();

    // "Restart": a brand-new bot sharing the durable store. Telegram still says "en",
    // but the explicit choice wins.
    const second = await startBot({ store, component: Switcher });
    await second.adapter.message('10', 'hi again', 'en');
    await wait();
    expect(lastText(second.adapter)).toBe('ሰላም|am');
    await second.bot.stop();
  });

  test('localeCallbackData buttons switch and persist without click handlers', async () => {
    const store = new MemorySessionStore();
    const { adapter, bot } = await startBot({ store, component: Switcher });
    await adapter.message('11', 'hi', 'en');
    await wait();
    await adapter.callback('11', localeCallbackData('pt'), 'en');
    await wait();
    expect(lastText(adapter)).toBe('Olá|pt');
    expect((await store.get('mock:11'))?.[LOCALE_SESSION_KEY]).toBe('pt');
    await bot.stop();

    // A fresh process (serverless cold start) handling the callback directly also works.
    const store2 = new MemorySessionStore();
    const cold = await startBot({ store: store2, component: Switcher });
    await cold.adapter.callback('12', localeCallbackData('am'), 'en');
    await wait();
    expect(lastText(cold.adapter)).toBe('ሰላም|am');
    expect((await store2.get('mock:12'))?.[LOCALE_SESSION_KEY]).toBe('am');
    await cold.bot.stop();
  });

  test('unknown locales are ignored with a warning', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemorySessionStore();
    const { adapter, bot } = await startBot({ store, component: Switcher });
    await adapter.message('13', 'hi', 'en');
    await wait();
    const bogus = findButtons(adapter.getLastSent()!.output).find((b) => b.props.text === 'bogus')!;
    await adapter.callback('13', bogus.props.callbackData, 'en');
    await wait();
    expect(lastText(adapter)).toBe('Hello|en');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('klingon'))).toBe(true);
    expect((await store.get('mock:13'))?.[LOCALE_SESSION_KEY]).toBeUndefined();
    warn.mockRestore();
    await bot.stop();
  });

  test('persist: false keeps the choice in memory only', async () => {
    const store = new MemorySessionStore();
    const { adapter, bot } = await startBot({ store, component: Switcher, persist: false });
    await adapter.message('14', 'hi', 'en');
    await wait();
    const amBtn = findButtons(adapter.getLastSent()!.output).find((b) => b.props.text === 'am')!;
    await adapter.callback('14', amBtn.props.callbackData, 'en');
    await wait();
    expect(lastText(adapter)).toBe('ሰላም|am');
    expect((await store.get('mock:14'))?.[LOCALE_SESSION_KEY]).toBeUndefined();
    await bot.stop();
  });

  test('a locale persisted by another instance is adopted on the next update', async () => {
    const store = new MemorySessionStore();
    const { adapter, bot } = await startBot({ store });
    await adapter.message('15', 'hi', 'en');
    await wait();
    expect(lastText(adapter)).toBe('Hello|en');
    await store.set('mock:15', { [LOCALE_SESSION_KEY]: 'am' });
    await adapter.message('15', 'again', 'en');
    await wait();
    expect(lastText(adapter)).toBe('ሰላም|am');
    await bot.stop();
  });
});

describe('MockAdapter languageCode → locale detection', () => {
  test('simulateMessage languageCode drives detection', async () => {
    const { createBot, createI18n, useLocale } = await import('../packages/core/src');
    const { MockAdapter } = await import('../packages/testing/src');
    const { Message } = await import('../packages/ui/src');
    const React = await import('react');
    const i18n = createI18n({
      defaultLocale: 'en',
      resources: { en: { translation: { hi: 'Hello' } }, de: { translation: { hi: 'Hallo' } } },
    });
    function App() {
      const { t } = useLocale();
      return React.createElement(Message, { text: t('hi') });
    }
    const adapter = new MockAdapter();
    const bot = createBot({ component: App, adapter, token: 't', providers: i18n.Provider });
    await bot.start();
    await adapter.simulateMessage('9', '9', 'x', { languageCode: 'de-AT' });
    expect(JSON.stringify(adapter.getLastSent())).toContain('Hallo');
    await bot.stop();
  });
});
