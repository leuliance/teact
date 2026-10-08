import { test, expect } from 'bun:test';
import React from 'react';
import { createBot, useSession } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

test('session writes in one update land in call order and are all awaited', async () => {
  const data = new Map<string, any>();
  let call = 0;
  const store = {
    async get(k: string) { return data.get(k) ?? null; },
    // first write is slower (e.g. different pool connection)
    async set(k: string, v: any) { const d = call++ === 0 ? 30 : 1; await new Promise(r => setTimeout(r, d)); data.set(k, v); },
    async delete(k: string) { data.delete(k); },
  };
  function C() {
    const [s, set] = useSession<{ a?: number; b?: number }>();
    if (s.a == null) set({ a: 1 });
    if (s.b == null) set({ b: 2 });
    return <Message text="ok" />;
  }
  const bot = createBot({ component: C, adapter: new MockAdapter(), token: 't', session: { store } });
  await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
  await new Promise(r => setTimeout(r, 50));
  expect(data.get('mock:1')).toEqual({ a: 1, b: 2 });
  await bot.stop();
});
