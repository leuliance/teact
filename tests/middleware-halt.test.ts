import { describe, test, expect } from 'bun:test';
import React from 'react';
import { compose, halt, isHalted, createBot, type BotContext, type Middleware } from '../packages/core/src';
import { MockAdapter } from '../packages/testing/src';

const ctx = (): BotContext => ({ chatId: '1', userId: '1', user: { id: '1', platform: 'mock' }, platform: 'mock', raw: {} });

describe('halt()', () => {
  test('stops the composed chain when the middleware returns', async () => {
    const order: number[] = [];
    const m1: Middleware = async (c) => { order.push(1); halt(c); };
    const m2: Middleware = async () => { order.push(2); };
    let finalCalled = false;
    const c = ctx();
    await compose([m1, m2])(c, async () => { finalCalled = true; });
    expect(order).toEqual([1]);
    expect(finalCalled).toBe(false);
    expect(isHalted(c)).toBe(true);
  });

  test('explicit next() after halt still continues', async () => {
    const order: number[] = [];
    const m1: Middleware = async (c, next) => { halt(c); await next(); };
    const m2: Middleware = async () => { order.push(2); };
    await compose([m1, m2])(ctx(), async () => {});
    expect(order).toEqual([2]);
  });

  test('is per-context (other updates unaffected)', async () => {
    const a = ctx();
    halt(a);
    expect(isHalted(a)).toBe(true);
    expect(isHalted(ctx())).toBe(false);
  });

  test('halting user middleware prevents rendering in createBot', async () => {
    const adapter = new MockAdapter();
    const App = () => React.createElement('tg-message', { text: 'rendered' });
    const bot = createBot({
      component: App, adapter, token: 'test',
      middleware: [async (c) => { if (c.text === 'block') halt(c); }],
    });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'block');
    expect(adapter.sent.length).toBe(0);
    await adapter.simulateMessage('1', '1', 'ok');
    expect(adapter.getLastSent()?.output.props.text).toBe('rendered');
    await bot.stop();
  });
});

describe('handler commands go through middleware', () => {
  test('middleware sees /command handlers and can halt them', async () => {
    const seen: string[] = [];
    let handled = 0;
    const adapter = new MockAdapter();
    const bot = createBot({
      component: () => React.createElement('tg-message', { text: 'x' }),
      adapter,
      token: 't',
      commands: {
        help: { description: 'Help', handler: 'Help text' },
        ping: { description: 'Ping', handler: async (c) => { handled++; await c.reply('pong'); } },
      },
      middleware: [
        async (ctx) => {
          seen.push(ctx.text ?? '');
          if (ctx.text === '/ping blocked') halt(ctx);
        },
      ],
    });
    await bot.start();
    await adapter.simulateMessage('1', '1', '/help');
    await adapter.simulateMessage('1', '1', '/ping');
    await adapter.simulateMessage('1', '1', '/ping blocked');
    expect(seen).toEqual(['/help', '/ping', '/ping blocked']);
    expect(handled).toBe(1);
    expect(JSON.stringify(adapter.sent.map((m) => m.output))).toContain('Help text');
    await bot.stop();
  });
});

describe('plugin de-duplication', () => {
  test('repeating a plugin in one list keeps both (layered rate limits)', async () => {
    const { rateLimit } = await import('../packages/plugins/src');
    const adapter = new MockAdapter();
    const bot = createBot({
      component: () => React.createElement('tg-message', { text: 'ok' }),
      adapter,
      token: 't',
      plugins: [
        rateLimit({ limit: 100, window: 1000 }),
        rateLimit({ key: 'chat', limit: 1, window: 60_000 }),
      ],
    });
    await bot.start();
    for (let i = 0; i < 5; i++) await adapter.simulateMessage('1', String(i), 'x');
    // only the first message gets past the per-chat limit
    expect(adapter.sent.filter((m) => JSON.stringify(m.output).includes('ok')).length).toBe(1);
    await bot.stop();
  });
});
