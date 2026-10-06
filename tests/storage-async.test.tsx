import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, useBot } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import {
  storagePlugin,
  useStorage,
  useGlobalStorage,
  createSessionStore,
  CachedDriver,
  MemoryAsyncDriver,
  MemoryDriver,
  isAsyncDriver,
  runDriverConformance,
} from '../packages/storage/src';

runDriverConformance('MemoryAsyncDriver', () => new MemoryAsyncDriver(), { describe, test, expect });

/** Async driver whose writes take a while — models a network round-trip. */
class SlowDriver extends MemoryAsyncDriver {
  writes = 0;
  async set<T>(key: string, value: T, opts?: { ttl?: number }) {
    await new Promise((r) => setTimeout(r, 15));
    this.writes++;
    return super.set(key, value, opts);
  }
}

describe('CachedDriver', () => {
  test('hydrate loads only the prefix and replaces stale entries', async () => {
    const backend = new MemoryAsyncDriver();
    await backend.set('a:1', 'one');
    await backend.set('b:1', 'other');
    const c = new CachedDriver(backend);
    await c.hydrate('a:');
    expect(c.get<any>('a:1')).toBe('one');
    expect(c.has('b:1')).toBe(false);

    await backend.delete('a:1');
    await c.hydrate('a:');
    expect(c.get<any>('a:1')).toBeUndefined();
  });

  test('writes hit the cache immediately and the backend after flush', async () => {
    const backend = new SlowDriver();
    const c = new CachedDriver(backend);
    c.set('k', 1);
    expect(c.get<any>('k')).toBe(1);
    expect(await backend.get<any>('k')).toBeUndefined();
    await c.flush();
    expect(await backend.get<any>('k')).toBe(1);
  });

  test('flush rethrows a failed write once', async () => {
    const backend = new MemoryAsyncDriver();
    backend.set = async () => { throw new Error('boom'); };
    const c = new CachedDriver(backend);
    c.set('k', 1);
    await expect(c.flush()).rejects.toThrow('boom');
    await c.flush(); // error consumed
  });

  test('clear() only removes hydrated prefixes, never the whole backend', async () => {
    const backend = new MemoryAsyncDriver();
    await backend.set('mock:1:a', 1);
    await backend.set('mock:2:a', 2);
    const c = new CachedDriver(backend);
    await c.hydrate('mock:1:');
    c.clear();
    await c.flush();
    expect(await backend.keys()).toEqual(['mock:2:a']);
    expect(c.get<any>('mock:1:a')).toBeUndefined();
  });

  test('isAsyncDriver tells drivers apart', () => {
    expect(isAsyncDriver(new MemoryAsyncDriver())).toBe(true);
    expect(isAsyncDriver(new MemoryDriver())).toBe(false);
  });
});

describe('storagePlugin with an async driver', () => {
  function Visits() {
    const { messageId } = useBot();
    const [visits, setVisits] = useStorage<{ n: number; last?: string }>('visits', { n: 0 });
    if (visits.last !== messageId) setVisits({ n: visits.n + 1, last: messageId });
    return <Message text={`visits ${visits.n}`} />;
  }

  test('writes are durable before bot.fetch() resolves', async () => {
    const backend = new SlowDriver();
    const bot = createBot({
      component: Visits,
      adapter: new MockAdapter(),
      token: 't',
      plugins: [storagePlugin({ driver: backend })],
    });
    const req = new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) });
    await bot.fetch(req);
    const keys = await backend.keys();
    expect(keys.length).toBe(1);
    expect(keys[0]).toEndWith(':visits');
    expect((await backend.get<{ n: number }>(keys[0]))!.n).toBe(1);
    await bot.stop();
  });

  test('values written by another instance are seen on the next update', async () => {
    const backend = new MemoryAsyncDriver();
    const adapter = new MockAdapter();
    function Show() {
      const [v] = useStorage<string>('greeting', 'none');
      return <Message text={`greeting=${v}`} />;
    }
    const bot = createBot({ component: Show, adapter, token: 't', plugins: [storagePlugin({ driver: backend })] });
    await bot.start();
    await backend.set('mock:42:greeting', 'hello');
    await adapter.simulateMessage('42', '1', 'x');
    expect(adapter.getLastSent()?.output.props.text ?? JSON.stringify(adapter.getLastSent())).toContain('greeting=hello');
    await bot.stop();
  });

  test('preload exposes shared prefixes to useGlobalStorage', async () => {
    const backend = new MemoryAsyncDriver();
    await backend.set('global:motd', 'Welcome!');
    const adapter = new MockAdapter();
    function Motd() {
      const g = useGlobalStorage();
      return <Message text={`motd=${g.get<string>('global:motd')}`} />;
    }
    const bot = createBot({
      component: Motd,
      adapter,
      token: 't',
      plugins: [storagePlugin({ driver: backend, preload: ['global:'] })],
    });
    await bot.start();
    await adapter.simulateMessage('7', '1', 'x');
    expect(JSON.stringify(adapter.getLastSent())).toContain('motd=Welcome!');
    await bot.stop();
  });

  test('onStop closes the backend', async () => {
    const backend = new MemoryAsyncDriver() as MemoryAsyncDriver & { close: () => Promise<void> };
    let closed = false;
    backend.close = async () => { closed = true; };
    const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver: backend })] });
    await bot.start();
    await bot.stop();
    expect(closed).toBe(true);
  });
});

describe('createSessionStore', () => {
  test('async driver: prefix + ttl', async () => {
    const backend = new MemoryAsyncDriver();
    const store = createSessionStore(backend, { prefix: 's:', ttl: 20 });
    await store.set('telegram:1', { a: 1 });
    expect(await backend.get<any>('s:telegram:1')).toEqual({ a: 1 });
    expect(await store.get('telegram:1')).toEqual({ a: 1 });
    await new Promise((r) => setTimeout(r, 40));
    expect(await store.get('telegram:1')).toBeNull();
  });

  test('sync driver', async () => {
    const store = createSessionStore(new MemoryDriver());
    expect(await store.get('x')).toBeNull();
    await store.set('x', { b: 2 });
    expect(await store.get('x')).toEqual({ b: 2 });
    await store.delete('x');
    expect(await store.get('x')).toBeNull();
  });

  test('works as createBot session store', async () => {
    const backend = new MemoryAsyncDriver();
    const { useSession } = await import('../packages/core/src');
    function C() {
      const [s, set] = useSession<{ seen?: boolean }>();
      if (!s.seen) set({ seen: true });
      return <Message text="ok" />;
    }
    const bot = createBot({ component: C, adapter: new MockAdapter(), token: 't', session: { store: createSessionStore(backend) } });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    const [key] = await backend.keys('session:');
    expect(await backend.get<any>(key)).toEqual({ seen: true });
    await bot.stop();
  });
});
