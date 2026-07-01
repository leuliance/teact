import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, useSession, useBot } from '../packages/core/src';
import type { SessionStore, SessionData, OutputNode } from '../packages/core/src/renderer';
import { Message, Photo } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An async store (models KV/Redis) with an artificial get-latency to expose races. */
function makeAsyncStore(getDelay = 0) {
  const data = new Map<string, SessionData>();
  const store: SessionStore & { data: Map<string, SessionData> } = {
    data,
    async get(k) { if (getDelay) await delay(getDelay); return data.get(k) ?? null; },
    async set(k, v) { await Promise.resolve(); data.set(k, v); },
    async delete(k) { data.delete(k); },
  };
  return store;
}

describe('serverless — session persistence survives isolate freeze', () => {
  test('an async session write completes BEFORE bot.fetch() resolves (no post-response tick)', async () => {
    const store = makeAsyncStore();
    function Counter() {
      const [s, setS] = useSession<{ count: number }>();
      if (s.count === undefined) setS({ count: 1 }); // write during render, once
      return <Message text={`count ${s.count ?? 0}`} />;
    }
    const adapter = new MockAdapter();
    const bot = createBot({ component: Counter, adapter, token: 't', session: { store } });

    const req = new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: '/start' }) });
    // No wait() — on Cloudflare the isolate can freeze the instant the Response resolves.
    await bot.fetch(req);

    // The write must already be durable.
    const key = [...store.data.keys()][0];
    expect(key).toBeDefined();
    expect(store.data.get(key!)).toEqual({ count: 1 });
    await bot.stop();
  });
});

describe('concurrency — per-chat serialization prevents lost updates', () => {
  test('two rapid updates to the same chat both apply (no read-modify-write race)', async () => {
    const store = makeAsyncStore(15); // slow reads make interleaving observable
    function Counter() {
      const [s, setS] = useSession<{ n: number; last?: string }>();
      const { messageId } = useBot();
      const n = s.n ?? 0;
      if (s.last !== messageId) setS({ n: n + 1, last: messageId });
      return <Message text={`n=${n}`} />;
    }
    const adapter = new MockAdapter();
    const bot = createBot({ component: Counter, adapter, token: 't', session: { store } });
    await bot.start();

    // Fire both without awaiting between them — they must still serialize per chat.
    const p1 = adapter.simulateMessage('1', '1', 'a');
    const p2 = adapter.simulateMessage('1', '1', 'b');
    await Promise.all([p1, p2]);
    await wait();

    const key = [...store.data.keys()][0];
    expect(store.data.get(key!)).toMatchObject({ n: 2 }); // 1 then 2, not a lost 1
    await bot.stop();
  });

  test('different chats are not serialized against each other', async () => {
    const store = makeAsyncStore(10);
    function View() {
      const { chatId } = useBot();
      return <Message text={`chat ${chatId}`} />;
    }
    const adapter = new MockAdapter();
    const bot = createBot({ component: View, adapter, token: 't', session: { store } });
    await bot.start();

    await Promise.all([
      adapter.simulateMessage('1', '1', 'x'),
      adapter.simulateMessage('2', '2', 'y'),
    ]);
    await wait();
    expect(adapter.sent.length).toBe(2);
    await bot.stop();
  });
});

describe('adapter — edit vs media guard', () => {
  test('canEdit is false when the chat’s last message was media (cannot edit text onto a photo)', async () => {
    const adapter = new MockAdapter();
    const photo: OutputNode = { type: 'tg-photo', props: { src: 'p.jpg' }, children: [] };
    const msg: OutputNode = { type: 'tg-message', props: { text: 'hi' }, children: [] };

    await adapter.send('1', photo);
    expect(adapter.canEdit(msg, '1')).toBe(false); // last was a photo → must send, not edit

    await adapter.send('2', msg);
    expect(adapter.canEdit(msg, '2')).toBe(true); // last was text → editable
  });
});
