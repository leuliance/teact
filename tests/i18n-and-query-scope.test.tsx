import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createI18n, useLocale, useQuery } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot } from '../packages/testing/src';

const i18n = createI18n({
  defaultLocale: 'en',
  resources: { en: { translation: { hi: 'Hello' } }, am: { translation: { hi: 'ሰላም' } } },
});

function Greeter() {
  const { t, setLocale } = useLocale();
  return (
    <Message text={t('hi')}>
      <InlineKeyboard><Button text="Amharic" onClick={() => setLocale('am')} /></InlineKeyboard>
    </Message>
  );
}

describe('createI18n', () => {
  test('the chosen locale survives /start (persisted in the session)', async () => {
    const t = await createTestBot({
      component: Greeter,
      providers: i18n.Provider,
      commands: { start: { description: 'Start' } },
    });
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('Hello');
    await t.click('Amharic');
    expect(t.lastMessage?.text).toBe('ሰላም');
    await t.send('/start'); // resets the React root…
    expect(t.lastMessage?.text).toBe('ሰላም'); // …but not the language
    await t.stop();
  });

  test('detects the initial locale from Telegram language_code', async () => {
    const t = await createTestBot({ component: Greeter, providers: i18n.Provider });
    await t.adapter.simulateMessage('1', '1', 'hi', {
      raw: { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: 1, language_code: 'am' }, text: 'hi' } },
    });
    expect(t.lastMessage?.text).toBe('ሰላም');
    await t.stop();
  });
});

describe('useQuery scope', () => {
  test('the same key is cached per chat, never shared between users', async () => {
    let calls = 0;
    function Profile() {
      const q = useQuery({ key: 'profile', fn: async () => `user-${++calls}` });
      return <Message text={q.data ?? 'loading'} />;
    }
    const a = await createTestBot({ component: Profile, chatId: '100' });
    await a.send('hi');
    await new Promise((r) => setTimeout(r, 20));
    const b = await createTestBot({ component: Profile, chatId: '200' });
    await b.send('hi');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(2); // chat 200 did NOT get chat 100's cached profile
    await a.stop();
    await b.stop();
  });
});
