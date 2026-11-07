import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, useService, type Middleware } from '../packages/core/src';
import { definePlugin } from '../packages/plugin-sdk/src';
import { MockAdapter } from '../packages/testing/src';

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));

describe('plugin-sdk · definePlugin (factory shape)', () => {
  test('wires services, middleware, provider, and lifecycle hooks', () => {
    const plugin = definePlugin<{ token: string }>({
      name: 'demo',
      defaultConfig: { token: 'default' },
      setup(ctx) {
        expect(ctx.config.token).toBe('override');
        ctx.provideService('demo', { ok: true });
        ctx.middleware(async (_c, next) => { await next(); });
        ctx.addProvider(({ children }) => React.createElement(React.Fragment, null, children));
        ctx.onStart(() => {});
        ctx.onStop(() => {});
      },
    })({ token: 'override' });

    expect(plugin.name).toBe('demo');
    expect(plugin.services).toEqual({ demo: { ok: true } });
    expect(typeof plugin.middleware).toBe('function');
    expect(typeof plugin.Provider).toBe('function');
    expect(typeof plugin.onStart).toBe('function');
    expect(typeof plugin.onStop).toBe('function');
  });

  test('omits unused fields', () => {
    const plugin = definePlugin({ name: 'empty', setup() {} })();
    expect(plugin.name).toBe('empty');
    expect(plugin.services).toBeUndefined();
    expect(plugin.middleware).toBeUndefined();
    expect(plugin.Provider).toBeUndefined();
  });
});

describe('plugin-sdk · end-to-end via createBot + MockAdapter', () => {
  test('useService reads a plugin-provided service in a component', async () => {
    const greeter = definePlugin({
      name: 'greeter',
      setup(ctx) { ctx.provideService('greeting', 'hello from a plugin'); },
    });

    function App() {
      const greeting = useService<string>('greeting');
      return React.createElement('tg-message', { text: greeting });
    }

    const adapter = new MockAdapter();
    const bot = createBot({ component: App, adapter, token: 'test', plugins: [greeter()] });
    await bot.start();
    adapter.simulateMessage('1', '1', 'hi');
    await wait();
    expect(adapter.getLastSent()?.output.props.text).toBe('hello from a plugin');
    await bot.stop();
  });

  test('plugin middleware runs on each update', async () => {
    let hits = 0;
    const counter = definePlugin({
      name: 'counter',
      setup(ctx) {
        const mw: Middleware = async (_c, next) => { hits++; await next(); };
        ctx.middleware(mw);
      },
    });

    const App = () => React.createElement('tg-message', { text: 'ok' });
    const adapter = new MockAdapter();
    const bot = createBot({ component: App, adapter, token: 'test', plugins: [counter()] });
    await bot.start();
    adapter.simulateMessage('1', '1', 'a');
    await wait();
    adapter.simulateMessage('1', '1', 'b');
    await wait();
    expect(hits).toBe(2);
    await bot.stop();
  });
});

describe('definePlugin middleware semantics (match core)', () => {
  const { definePlugin } = require('../packages/plugin-sdk/src');

  test('auto-next and `return false` both work inside a plugin', async () => {
    const order: string[] = [];
    const guard = definePlugin({
      name: 'guard',
      setup(ctx: any) {
        ctx.middleware(() => { order.push('logger'); });               // no next() → implied
        ctx.middleware((c: any) => { order.push('ban'); if (c.text === 'spam') return false; });
      },
    });
    const { createTestBot } = require('../packages/testing/src');
    const React = require('react');
    const t = await createTestBot({
      component: () => React.createElement('tg-message', { text: 'ok' }),
      plugins: [guard()],
    });
    await t.send('spam');
    expect(order).toEqual(['logger', 'ban']);
    expect(t.messages).toHaveLength(0);
    await t.send('hello');
    expect(t.messages).toHaveLength(1);
    await t.stop();
  });

  test('async setup fails loudly instead of losing registrations', () => {
    const bad = definePlugin({ name: 'bad', async setup(ctx: any) { await 0; ctx.provideService('db', 1); } });
    expect(() => bad()).toThrow(/must be synchronous/);
  });
});
