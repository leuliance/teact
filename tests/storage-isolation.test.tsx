import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, useText } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { storagePlugin, useStorage, useGlobalStorage, MemoryAsyncDriver } from '../packages/storage/src';

/** Each chat gets its own per-update cache; nothing leaks between chats. */
describe('storagePlugin (async) — chat isolation', () => {
  test('useGlobalStorage().clear() in one chat never touches another chat', async () => {
    const backend = new MemoryAsyncDriver();
    await backend.set('mock:1:fav', 'A');
    await backend.set('mock:2:fav', 'B');
    const adapter = new MockAdapter();
    function C() {
      const g = useGlobalStorage();
      if (useText() === 'clear') g.clear();
      return <Message text={`keys=${g.keys().join(',')}`} />;
    }
    const bot = createBot({ component: C, adapter, token: 't', plugins: [storagePlugin({ driver: backend })] });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'hi');
    await adapter.simulateMessage('2', '2', 'clear');
    expect(await backend.get<string>('mock:1:fav')).toBe('A');
    expect(await backend.get<string>('mock:2:fav')).toBeUndefined();
    // chat 1 only ever sees its own keys
    await adapter.simulateMessage('1', '1', 'hi');
    expect(JSON.stringify(adapter.sent.at(-1))).toContain('keys=mock:1:fav');
    await bot.stop();
  });

  test("a failed write is reported in its own chat's update, not another chat's", async () => {
    const backend = new MemoryAsyncDriver();
    const set = backend.set.bind(backend);
    backend.set = (async (k: string, v: unknown) => {
      if (k.startsWith('mock:1:')) throw new Error('chat 1 write failed');
      return set(k, v);
    }) as typeof backend.set;
    const errors: string[] = [];
    const adapter = new MockAdapter();
    function C() {
      const [v, setV] = useStorage<number>('v', 0);
      if (v === 0) setV(1);
      return <Message text="x" />;
    }
    const bot = createBot({
      component: C,
      adapter,
      token: 't',
      plugins: [
        // Registered before storage, so it wraps storage's flush.
        { name: 'catch', middleware: async (ctx, next) => { try { await next(); } catch (e) { errors.push(`${ctx.chatId}:${(e as Error).message}`); } } },
        storagePlugin({ driver: backend }),
      ],
    });
    await bot.start();
    await Promise.all([adapter.simulateMessage('1', '1', 'a'), adapter.simulateMessage('2', '2', 'b')]);
    expect(errors).toEqual(['1:chat 1 write failed']);
    expect(await backend.get<number>('mock:2:v')).toBe(1);
    await bot.stop();
  });

  test('onClick writes made with a setter from an earlier render are flushed with the current update', async () => {
    const backend = new MemoryAsyncDriver();
    const adapter = new MockAdapter();
    function Counter() {
      const [n, setN] = useStorage<number>('n', 0);
      return (
        <Message text={`n=${n}`}>
          <InlineKeyboard><Button text="+" onClick={() => setN((p) => p + 1)} /></InlineKeyboard>
        </Message>
      );
    }
    const bot = createBot({ component: Counter, adapter, token: 't', plugins: [storagePlugin({ driver: backend })] });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'hi');
    const cb = JSON.stringify(adapter.sent.at(-1)).match(/__cb:[^"]+/)![0];
    await adapter.simulateCallback('1', '1', cb, '1');
    expect(await backend.get<number>('mock:1:n')).toBe(1);
    expect(JSON.stringify(adapter.edited.at(-1))).toContain('n=1');
    await bot.stop();
  });

  test("preload keys hydrated by another chat don't overwrite an in-flight write", async () => {
    const backend = new MemoryAsyncDriver();
    await backend.set('global:count', 1);
    const adapter = new MockAdapter();
    const seen: unknown[] = [];
    function C() {
      const g = useGlobalStorage();
      const text = useText();
      if (text === 'inc') g.set('global:count', (g.get<number>('global:count') ?? 0) + 1);
      seen.push(g.get('global:count'));
      return <Message text="x" />;
    }
    const bot = createBot({ component: C, adapter, token: 't', plugins: [storagePlugin({ driver: backend, preload: ['global:'] })] });
    await bot.start();
    await Promise.all([adapter.simulateMessage('1', '1', 'inc'), adapter.simulateMessage('2', '2', 'read')]);
    expect(await backend.get<number>('global:count')).toBe(2);
    await bot.stop();
  });
});
