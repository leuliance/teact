import { describe, test, expect, afterAll } from 'bun:test';
import React from 'react';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBot, useBot, useSession } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { storagePlugin, useStorage, createSessionStore, runDriverConformance } from '../packages/storage/src';
import type { StorageDriver } from '../packages/storage/src';
import {
  SqliteDriver,
  SqliteAsyncDriver,
  sqlitePlugin,
  sqliteSessionStore,
  useSqlite,
  quoteSqliteIdent,
  createSqliteTableSql,
} from '../packages/sqlite/src';
import { escapeLike } from '../packages/sqlite/src/driver';
import * as sqliteIndex from '../packages/sqlite/src';

const tmp = mkdtempSync(join(tmpdir(), 'teact-sqlite-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const mem = () => new SqliteDriver({ path: ':memory:' });
const post = (text = 'hi') => new Request('https://x/', { method: 'POST', body: JSON.stringify({ text }) });

runDriverConformance('SqliteDriver.asAsync()', () => mem().asAsync(), { describe, test, expect });
runDriverConformance('SqliteAsyncDriver (custom table)', () => new SqliteAsyncDriver(new SqliteDriver({ db: new Database(':memory:'), table: 'kv' })), { describe, test, expect });

describe('SqliteDriver (sync StorageDriver)', () => {
  test('get returns undefined for a missing key', () => {
    expect(mem().get<any>('missing')).toBeUndefined();
  });

  test('stores strings, numbers, booleans, null, arrays and objects', () => {
    const d = mem();
    const values: Record<string, unknown> = { s: 'Alice', n: 42, z: 0, t: true, f: false, nul: null, arr: [1, 'two'], obj: { a: { b: [1, 2] } } };
    for (const [k, v] of Object.entries(values)) d.set(k, v);
    for (const [k, v] of Object.entries(values)) {
      expect(d.get<any>(k)).toEqual(v);
      expect(d.has(k)).toBe(true);
    }
  });

  test('set overwrites; delete removes; deleting missing is a no-op', () => {
    const d = mem();
    d.set('count', 1);
    d.set('count', 2);
    expect(d.get<any>('count')).toBe(2);
    d.delete('count');
    expect(d.get<any>('count')).toBeUndefined();
    expect(() => d.delete('count')).not.toThrow();
  });

  test('set(undefined) deletes the key', () => {
    const d = mem();
    d.set('k', 1);
    d.set('k', undefined);
    expect(d.has('k')).toBe(false);
  });

  test('returned values are copies', () => {
    const d = mem();
    d.set('o', { a: 1 });
    d.get<{ a: number }>('o')!.a = 99;
    expect(d.get<any>('o')).toEqual({ a: 1 });
  });

  test('has / keys / clear', () => {
    const d = mem();
    expect(d.has('nope')).toBe(false);
    expect(d.keys()).toEqual([]);
    d.set('b', 2);
    d.set('a', 1);
    expect(d.keys()).toEqual(['a', 'b']);
    d.clear();
    expect(d.keys()).toEqual([]);
    expect(d.get<any>('a')).toBeUndefined();
  });

  test('prefix ops are literal and case-sensitive', () => {
    const d = mem();
    d.set('telegram:1:a', 'A');
    d.set('Telegram:1:b', 'upper');
    d.set('telegram:1_x', 'underscore');
    d.set('50%:x', 'pct');
    d.set('50a:x', 'no');
    d.set('back\\slash:x', 'bs');
    expect(d.keys('telegram:1:')).toEqual(['telegram:1:a']);
    expect(d.keys('50%:')).toEqual(['50%:x']);
    expect(d.keys('back\\slash:')).toEqual(['back\\slash:x']);
    expect(d.entries('telegram:')).toEqual([['telegram:1:a', 'A'], ['telegram:1_x', 'underscore']]);
    d.clear('telegram:');
    expect(d.keys().sort()).toEqual(['50%:x', '50a:x', 'Telegram:1:b', 'back\\slash:x'].sort());
  });

  test('escapeLike escapes % _ and backslash (internal, not exported from the index)', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d%');
    expect('escapeLike' in sqliteIndex).toBe(false);
  });

  test('sync set: ttl 0, negative, NaN and Infinity mean no expiry', async () => {
    const d = mem();
    for (const [i, ttl] of [0, -1, NaN, Infinity].entries()) d.set(`k${i}`, i, { ttl });
    await Bun.sleep(5);
    expect(d.keys()).toEqual(['k0', 'k1', 'k2', 'k3']);
    const rows = d.db.prepare('SELECT expires_at FROM teact_storage').all() as Array<{ expires_at: number | null }>;
    expect(rows.every((r) => r.expires_at === null)).toBe(true);
  });

  test('sync incr: upsert, floats, expired rows reset, ttl only on creation, non-numbers rejected', async () => {
    const d = mem();
    expect(d.incr('n')).toBe(1);
    expect(d.incr('n', 4)).toBe(5);
    expect((d.db.prepare("SELECT value FROM teact_storage WHERE key = 'n'").get() as { value: string }).value).toBe('5');
    expect(d.get<number>('n')).toBe(5);
    expect(d.incr('f', 0.5)).toBe(0.5);
    expect(d.incr('f', 1)).toBe(1.5);
    d.set('e', 100, { ttl: 10 });
    await Bun.sleep(25);
    expect(d.incr('e', 1, { ttl: 60_000 })).toBe(1);
    expect(d.has('e')).toBe(true);
    d.incr('t', 1, { ttl: 20 });
    d.incr('t', 1, { ttl: 60_000 });
    await Bun.sleep(40);
    expect(d.get('t')).toBeUndefined();
    d.set('s', 'text');
    expect(() => d.incr('s')).toThrow('not a number');
    expect(d.get<string>('s')).toBe('text');
    expect(() => d.incr('x', Infinity)).toThrow('finite');
  });

  test('ttl hides expired rows and purgeExpired deletes them', async () => {
    const d = mem();
    d.set('short', 'v', { ttl: 20 });
    d.set('long', 'v');
    expect(d.get<any>('short')).toBe('v');
    await Bun.sleep(40);
    expect(d.get<any>('short')).toBeUndefined();
    expect(d.has('short')).toBe(false);
    expect(d.keys()).toEqual(['long']);
    expect(d.purgeExpired()).toBe(1);
    expect(d.purgeExpired()).toBe(0);
    expect((d.db.prepare('SELECT count(*) AS n FROM teact_storage').get() as { n: number }).n).toBe(1);
  });

  test('set without ttl clears a previous ttl', async () => {
    const d = mem();
    d.set('k', 1, { ttl: 10 });
    d.set('k', 2);
    await Bun.sleep(25);
    expect(d.get<any>('k')).toBe(2);
  });

  test('implements StorageDriver interface', () => {
    const d: StorageDriver = mem();
    for (const m of ['get', 'set', 'delete', 'has', 'clear', 'keys'] as const) expect(typeof d[m]).toBe('function');
  });

  test('accepts a bun:sqlite Database directly and never closes it', () => {
    const db = new Database(':memory:');
    const d = new SqliteDriver(db);
    d.set('x', 1);
    d.close();
    expect((db.prepare('SELECT value FROM teact_storage').get() as { value: string }).value).toBe('1');
    db.close();
  });

  test('asAsync returns a stable view over the same rows', async () => {
    const d = mem();
    expect(d.asAsync()).toBe(d.asAsync());
    d.set('a', 1);
    expect(await d.asAsync().get<number>('a')).toBe(1);
    await d.asAsync().set('b', 2);
    expect(d.get<any>('b')).toBe(2);
  });

  test('throws without path or db', () => {
    expect(() => new SqliteDriver({})).toThrow(/path/);
  });
});

describe('SqliteDriver file persistence', () => {
  test('values survive close + reopen; WAL enabled', () => {
    const path = join(tmp, 'bot.db');
    const a = new SqliteDriver({ path });
    a.set('user:1', { name: 'Ada' });
    a.set('gone', 1, { ttl: 60_000 });
    expect((a.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    a.close();
    a.close(); // idempotent
    expect(existsSync(path)).toBe(true);

    const b = new SqliteDriver({ path });
    expect(b.get<any>('user:1')).toEqual({ name: 'Ada' });
    expect(b.get<any>('gone')).toBe(1);
    b.close();
  });

  test('path in a missing nested directory: the directories are created', () => {
    const path = join(tmp, 'fresh', 'nested', '.teact', 'bot.db');
    expect(existsSync(join(tmp, 'fresh'))).toBe(false);
    const d = new SqliteDriver({ path });
    d.set('k', 1);
    d.close();
    expect(existsSync(path)).toBe(true);
    rmSync(join(tmp, 'fresh'), { recursive: true, force: true });
  });

  test('open errors on Bun report the bun:sqlite cause, not better-sqlite3', () => {
    const dir = join(tmp, 'is-a-dir');
    new SqliteDriver({ path: join(dir, 'x.db') }).close();
    let err: any;
    try { new SqliteDriver({ path: dir }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('bun:sqlite could not open');
    expect(err.message).not.toContain('better-sqlite3');
    expect(err.cause).toBeDefined();
  });

  test('separate tables in one file are isolated', () => {
    const path = join(tmp, 'multi.db');
    const a = new SqliteDriver({ path, table: 'a_store' });
    const b = new SqliteDriver({ path, table: 'b_store' });
    a.set('k', 'a');
    b.set('k', 'b');
    expect(a.get<any>('k')).toBe('a');
    expect(b.get<any>('k')).toBe('b');
    a.close();
    b.close();
  });
});

describe('identifier validation', () => {
  test('accepts plain identifiers', () => {
    expect(quoteSqliteIdent('teact_storage')).toBe('"teact_storage"');
    expect(quoteSqliteIdent('_T1')).toBe('"_T1"');
  });

  test.each(['', '1abc', 'a-b', 'a b', 'x"; DROP TABLE y; --', 'a.b', 'a'.repeat(64)])('rejects %p', (name) => {
    expect(() => quoteSqliteIdent(name)).toThrow(/Invalid table name/);
    expect(() => new SqliteDriver({ path: ':memory:', table: name })).toThrow(/Invalid table name/);
  });

  test('createSqliteTableSql uses the quoted name', () => {
    expect(createSqliteTableSql('my_kv')).toContain('CREATE TABLE IF NOT EXISTS "my_kv"');
  });
});

describe('sqlite + storagePlugin', () => {
  function Visits() {
    const { messageId } = useBot();
    const [visits, setVisits] = useStorage<{ n: number; last?: string }>('visits', { n: 0 });
    if (visits.last !== messageId) setVisits({ n: visits.n + 1, last: messageId });
    return <Message text={`visits ${visits.n}`} />;
  }

  test('sync driver: useStorage reads and writes straight through', async () => {
    const driver = mem();
    const adapter = new MockAdapter();
    const bot = createBot({ component: Visits, adapter, token: 't', plugins: [storagePlugin({ driver })] });
    await bot.start();
    await adapter.simulateMessage('42', '1', 'a');
    await adapter.simulateMessage('42', '1', 'b');
    expect(driver.keys()).toEqual(['mock:42:visits']);
    expect(driver.get<{ n: number }>('mock:42:visits')!.n).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(adapter.getLastSent())).toContain('visits');
    await bot.stop();
    driver.close();
  });

  test('async view: writes are durable before bot.fetch() resolves', async () => {
    const driver = mem();
    const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver: driver.asAsync() })] });
    await bot.fetch(post());
    const keys = driver.keys();
    expect(keys.length).toBe(1);
    expect(keys[0]).toEndWith(':visits');
    expect(driver.get<{ n: number }>(keys[0])!.n).toBe(1);
    await bot.stop();
  });
});

describe('sqlite sessions', () => {
  function Seen() {
    const [s, set] = useSession<{ seen?: number }>();
    if (!s.seen) set({ seen: 1 });
    return <Message text="ok" />;
  }

  test('createSessionStore(driver) persists sessions before bot.fetch() resolves', async () => {
    const driver = mem();
    const bot = createBot({ component: Seen, adapter: new MockAdapter(), token: 't', session: { store: createSessionStore(driver) } });
    await bot.fetch(post());
    const [key] = driver.keys('session:');
    expect(key).toBeDefined();
    expect(driver.get<any>(key)).toEqual({ seen: 1 });
    await bot.stop();
  });

  test('sqliteSessionStore honours prefix + ttl', async () => {
    const driver = mem();
    const store = sqliteSessionStore(driver, { prefix: 's:', ttl: 20 });
    await store.set('mock:1', { a: 1 });
    expect(driver.get<any>('s:mock:1')).toEqual({ a: 1 });
    expect(await store.get('mock:1')).toEqual({ a: 1 });
    await Bun.sleep(40);
    expect(await store.get('mock:1')).toBeNull();
    await store.set('mock:2', { b: 2 });
    await store.delete('mock:2');
    expect(await store.get('mock:2')).toBeNull();
  });

  test('sqliteSessionStore from a file path works in createBot', async () => {
    const path = join(tmp, 'sessions.db');
    const bot = createBot({ component: Seen, adapter: new MockAdapter(), token: 't', session: { store: sqliteSessionStore({ path }) } });
    await bot.fetch(post());
    await bot.stop();
    const check = new SqliteDriver({ path });
    expect(check.entries('session:').map(([, v]) => v)).toEqual([{ seen: 1 }]);
    check.close();
  });
});

describe('sqlitePlugin', () => {
  test('provides the driver via useSqlite() and closes a db it opened', async () => {
    const adapter = new MockAdapter();
    let seen: SqliteDriver | undefined;
    function C() {
      const sqlite = useSqlite();
      seen = sqlite;
      sqlite.set('hits', (sqlite.get<number>('hits') ?? 0) + 1);
      const row = sqlite.db.prepare('SELECT count(*) AS n FROM teact_storage').get() as { n: number };
      return <Message text={`rows=${row.n}`} />;
    }
    const bot = createBot({ component: C, adapter, token: 't', plugins: [sqlitePlugin({ path: join(tmp, 'plugin.db') })] });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'x');
    expect(JSON.stringify(adapter.getLastSent())).toContain('rows=1');
    expect(seen).toBeInstanceOf(SqliteDriver);
    await bot.stop();
    expect(() => seen!.get('hits')).toThrow();
  });

  test('a shared driver is not closed on stop', async () => {
    const driver = mem();
    const plugin = sqlitePlugin({ driver });
    expect(plugin.services?.sqlite).toBe(driver);
    await plugin.onStop?.();
    driver.set('still', 'open');
    expect(driver.get<any>('still')).toBe('open');
  });
});
