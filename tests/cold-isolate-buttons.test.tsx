import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, createRouter } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

/** Button presses that reach a process which didn't render the message (restart / new serverless isolate). */
describe('buttons on a cold process', () => {
  test('an unknown onClick button re-renders in place (edit), not as a duplicate message', async () => {
    const adapter = new MockAdapter();
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
    try {
      const bot = createBot({ component: () => <Message text="home" />, adapter, token: 't' });
      await bot.start();
      await adapter.simulateCallback('1', '1', '__cb:stale', '555');
      expect(adapter.sent.length).toBe(0);
      expect(adapter.edited.at(-1)?.messageId).toBe(555);
      expect(warnings.some((w) => w.includes('No handler for button'))).toBe(true);
      await bot.stop();
    } finally {
      console.warn = warn;
    }
  });

  test('a route button edits the message it lives on', async () => {
    const adapter = new MockAdapter();
    const router = createRouter({
      '/': () => <Message text="home"><InlineKeyboard><Button text="About" route="/about" /></InlineKeyboard></Message>,
      '/about': () => <Message text="about" />,
    });
    const bot = createBot({ router, adapter, token: 't' });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'hi');
    const msgId = 1; // MockAdapter numbers sent messages from 1
    await adapter.simulateCallback('1', '1', '__route:/about', String(msgId));
    expect(adapter.sent.length).toBe(1);
    expect(adapter.edited.at(-1)?.messageId).toBe(msgId);
    expect(JSON.stringify(adapter.edited.at(-1)?.output)).toContain('about');
    await bot.stop();
  });
});
