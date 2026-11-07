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
