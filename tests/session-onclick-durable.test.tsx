import { test, expect } from 'bun:test';
import React from 'react';
import { createBot, useSession } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { createSessionStore, MemoryAsyncDriver } from '../packages/storage/src';

class Slow extends MemoryAsyncDriver {
  async set<T>(k: string, v: T, o?: any) { await new Promise(r => setTimeout(r, 30)); return super.set(k, v, o); }
}

test('an onClick session update is durable before the update finishes', async () => {
  const backend = new Slow();
  const adapter = new MockAdapter();
  function C() {
    const [s, set] = useSession<{ n?: number }>();
    const n = s.n ?? 0;
    return <Message text={`n=${n}`}><InlineKeyboard><Button text="+" onClick={() => set({ n: n + 1 })} /></InlineKeyboard></Message>;
  }
  const bot = createBot({ component: C, adapter, token: 't', session: { store: createSessionStore(backend) } });
  await bot.start();
  await adapter.simulateMessage('1', '1', 'hi');
  const btn = JSON.stringify(adapter.sent.at(-1)).match(/__cb:[^"]+/)![0];
  await adapter.simulateCallback('1', '1', btn, '1');
  const shown = JSON.stringify(adapter.edited.at(-1) ?? adapter.sent.at(-1)).match(/n=\d+/)![0];
  const stored = await backend.get<any>('session:mock:1');
  await new Promise(r => setTimeout(r, 60));
  expect(shown).toBe('n=1');
  expect(stored?.n).toBe(1);
  await bot.stop();
});
