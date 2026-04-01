import { describe, test, expect } from 'bun:test';
import { MemorySessionStore } from '../packages/runtime/src/session';

describe('MemorySessionStore', () => {
  test('stores and retrieves session data', async () => {
    const store = new MemorySessionStore();
    await store.set('user1', { count: 5 });

    const data = await store.get('user1');
    expect(data).toEqual({ count: 5 });
  });

  test('returns null for non-existent keys', async () => {
    const store = new MemorySessionStore();
    const data = await store.get('nonexistent');
    expect(data).toBeNull();
  });

  test('deletes session data', async () => {
    const store = new MemorySessionStore();
    await store.set('user1', { count: 5 });
    await store.delete('user1');

    const data = await store.get('user1');
    expect(data).toBeNull();
  });

  test('expires sessions after TTL', async () => {
    const store = new MemorySessionStore(10); // 10ms TTL
    await store.set('user1', { count: 5 });

    await new Promise((r) => setTimeout(r, 20));

    const data = await store.get('user1');
    expect(data).toBeNull();
  });

  test('tracks store size', async () => {
    const store = new MemorySessionStore();
    expect(store.size).toBe(0);

    await store.set('a', {});
    await store.set('b', {});
    expect(store.size).toBe(2);

    await store.delete('a');
    expect(store.size).toBe(1);
  });

  test('cleanup removes expired entries', async () => {
    const store = new MemorySessionStore(10);
    await store.set('a', {});
    await store.set('b', {});

    await new Promise((r) => setTimeout(r, 20));
    store.cleanup();

    expect(store.size).toBe(0);
  });
});
