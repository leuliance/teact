import { describe, test, expect } from 'bun:test';
import React from 'react';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemorySessionStore, useSession } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { FileDriver } from '../packages/storage/src';
import { createTestBot } from '../packages/testing/src';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'teact-battle-')), 'store.json');

describe('FileDriver: bad values', () => {
  test('one unserializable value must not poison every later write', () => {
    const file = tmpFile();
    const d = new FileDriver(file);
    expect(() => d.set('bad', 10n as unknown)).toThrow(/serializ/i);
    d.set('good', 1);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ good: 1 });
  });

  test('circular values are rejected up front', () => {
    const d = new FileDriver(tmpFile());
    const o: any = { a: 1 }; o.self = o;
    expect(() => d.set('loop', o)).toThrow(/serializ/i);
  });

  test('set(key, undefined) behaves like delete — same before and after restart', () => {
    const file = tmpFile();
    const d = new FileDriver(file);
    d.set('k', 1);
    d.set('k', undefined);
    expect(d.has('k')).toBe(false);
    expect(new FileDriver(file).has('k')).toBe(false);
  });
});

describe('MemorySessionStore', () => {
  test('mutating a loaded session without saving it does not persist (same as Redis/KV)', async () => {
    const s = new MemorySessionStore();
    await s.set('k', { n: 1 });
    const loaded = (await s.get('k'))!;
    loaded.n = 999; // forgot to call setSession
    expect((await s.get('k'))!.n).toBe(1);
  });

  test('expired sessions are swept even if their chat never comes back', async () => {
    const s = new MemorySessionStore(5); // 5ms TTL
    for (let i = 0; i < 50; i++) await s.set(`chat-${i}`, { i });
    await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 1000; i++) await s.set(`active-${i % 3}`, { i }); // other chats keep writing
    expect(s.size).toBeLessThanOrEqual(3);
  });
});

describe('session writes in the engine', () => {
  test('mutating the session object directly (no setSession) does not silently persist', async () => {
    function Bad() {
      const [session] = useSession<{ n?: number }>();
      return (
        <Message text={`n=${session.n ?? 0}`}>
          <InlineKeyboard><Button text="inc" onClick={() => { session.n = (session.n ?? 0) + 1; }} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Bad });
    await t.send('hi');
    await t.click('inc');
    await t.send('/again');
    // Behaves like a real external store: the unsaved mutation is gone on the next update.
    expect(t.lastMessage?.text).toBe('n=0');
    await t.stop();
  });
});

describe('serverless: late session writes are waited for', () => {
  test('a setSession after data loads is persisted before the request ends', async () => {
    const { createBot, useQuery } = await import('../packages/core/src');
    const { MockAdapter } = await import('../packages/testing/src');
    const { useEffect } = await import('react');
    const saved: any[] = [];
    // A store whose writes are slow and NOT fetch-based (like Redis over TCP / a KV binding).
    const store = {
      get: async () => null,
      set: async (_k: string, v: any) => { await new Promise((r) => setTimeout(r, 900)); saved.push(v); },
      delete: async () => {},
    };
    function Profile() {
      const [key] = React.useState(() => `p-${Math.random()}`);
      const q = useQuery({ key, fn: async () => { await new Promise((r) => setTimeout(r, 100)); return 'Ada'; } });
      const [, setSession] = useSession<{ name?: string }>();
      useEffect(() => { if (q.data) setSession({ name: q.data }); }, [q.data]);
      return <Message text={q.data ?? '…'} />;
    }
    const bot = createBot({ adapter: new MockAdapter(), component: Profile, token: 't', session: { store } });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    expect(saved).toEqual([{ name: 'Ada' }]);
    await bot.stop();
  });
});

describe('async storage drivers (Redis / KV style)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** An async KV with latency, like Redis over the network. */
  function fakeKV(latency = 30) {
    const data = new Map<string, string>();
    return {
      data,
      get: async (k: string) => { await sleep(latency); return data.get(k) ?? null; },
      set: async (k: string, v: string) => { await sleep(latency); data.set(k, v); },
      delete: async (k: string) => { await sleep(latency); data.delete(k); },
      keys: async (p: string) => [...data.keys()].filter((k) => k.startsWith(p)),
    };
  }

  test('shows the default while loading, then the stored value; survives restart', async () => {
    const { storagePlugin, useStorage, kvStorageDriver } = await import('../packages/storage/src');
    const kv = fakeKV();
    function Favs() {
      const [favs, setFavs, { loading }] = useStorage<number[]>('favs', []);
      return (
        <Message text={loading ? 'loading…' : `favs=${favs.join(',')}`}>
          <InlineKeyboard><Button text="add" onClick={() => setFavs((p) => [...p, p.length + 1])} /></InlineKeyboard>
        </Message>
      );
    }
    const a = await createTestBot({ component: Favs, plugins: [storagePlugin({ driver: kvStorageDriver(kv) })] });
    await a.send('hi');
    await sleep(100);
    expect(a.lastMessage?.text).toBe('favs=');
    await a.click('add'); await a.click('add'); await a.click('add'); // rapid updates — no lost writes
    await sleep(150);
    expect(a.lastMessage?.text).toBe('favs=1,2,3');
    expect(JSON.parse(kv.data.get('teact:storage:mock:1:favs')!)).toEqual([1, 2, 3]);
    await a.stop();
    // "restart": a new driver instance over the same backend (no shared cache)
    const b = await createTestBot({ component: Favs, plugins: [storagePlugin({ driver: kvStorageDriver(kv) })] });
    await b.send('hi');
    await sleep(100);
    expect(b.lastMessage?.text).toBe('favs=1,2,3');
    await b.stop();
  });

  test("scope: 'user' keeps group members apart; 'global' is shared by every chat", async () => {
    const { storagePlugin, useStorage, MemoryDriver } = await import('../packages/storage/src');
    const driver = new MemoryDriver();
    function Prefs() {
      const [mine, setMine] = useStorage('theme', 'light', { scope: 'user' });
      const [hits, setHits] = useStorage('hits', 0, { scope: 'global' });
      return (
        <Message text={`${mine} ${hits}`}>
          <InlineKeyboard>
            <Button text="dark" onClick={() => setMine('dark')} />
            <Button text="hit" onClick={() => setHits((h) => h + 1)} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Prefs, chatId: '-100', userId: '1', plugins: [storagePlugin({ driver })] });
    await t.send('hi');
    await t.click('dark');
    await t.click('hit');
    await t.adapter.simulateMessage('-100', '2', 'hi'); // another member
    expect(t.lastMessage?.text).toBe('light 1');
    await t.adapter.simulateMessage('555', '3', 'hi');  // a different chat
    expect(t.adapter.getLastSent()?.output.props.text ?? '').toBe('light 1');
    await t.stop();
  });

  test('serverless: the async write finishes before the request ends', async () => {
    const { createBot } = await import('../packages/core/src');
    const { MockAdapter } = await import('../packages/testing/src');
    const { storagePlugin, useStorage, kvStorageDriver } = await import('../packages/storage/src');
    const kv = fakeKV(400);
    function Visit() {
      const [n, setN, { loading }] = useStorage('visits', 0);
      React.useEffect(() => { if (!loading) setN((v) => v + 1); }, [loading]);
      return <Message text={`visits=${n}`} />;
    }
    const bot = createBot({ adapter: new MockAdapter(), component: Visit, token: 't', plugins: [storagePlugin({ driver: kvStorageDriver(kv) })] });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    expect(kv.data.get('teact:storage:mock:1:visits')).toBe('1');
    await bot.stop();
  });

  test('a failing backend shows the default and logs — no crash', async () => {
    const { storagePlugin, useStorage, kvStorageDriver } = await import('../packages/storage/src');
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      const broken = kvStorageDriver({ get: async () => { throw new Error('ECONNREFUSED'); }, set: async () => { throw new Error('ECONNREFUSED'); }, delete: async () => {} });
      function P() { const [v] = useStorage('x', 'fallback'); return <Message text={v} />; }
      const t = await createTestBot({ component: P, plugins: [storagePlugin({ driver: broken })] });
      await t.send('hi');
      await sleep(50);
      expect(t.lastMessage?.text).toBe('fallback');
      await t.stop();
    } finally {
      console.error = orig;
    }
    expect(errors.some((e) => e.includes('ECONNREFUSED'))).toBe(true);
  });

  test('corrupt JSON in the backend is treated as missing', async () => {
    const { kvStorageDriver } = await import('../packages/storage/src');
    const kv = fakeKV(0);
    kv.data.set('teact:storage:k', '{not json');
    expect(await kvStorageDriver(kv).get('k')).toBeUndefined();
  });
});
