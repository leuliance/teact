import { describe, test, expect, afterAll } from 'bun:test';
import React from 'react';
import { PGlite } from '@electric-sql/pglite';
import { createBot, useBot, useSession } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { storagePlugin, useStorage, createSessionStore, runDriverConformance } from '../packages/storage/src';
import {
  PostgresDriver,
  postgresPlugin,
  postgresSessionStore,
  usePostgres,
  createTableSql,
  createTableStatements,
  quotePgIdent,
  escapeLike,
  fromPg,
  fromPglite,
  fromPostgresJs,
  fromNeon,
  toQueryFn,
} from '../packages/postgres/src';
import type { QueryFn, Row } from '../packages/postgres/src';

// One real Postgres (WASM) for the whole file — startup is slow. Each driver gets its own table.
const pg = new PGlite();
await pg.waitReady;
afterAll(() => pg.close());

let n = 0;
const freshTable = () => `t_${++n}`;
const post = (text = 'hi') => new Request('https://x/', { method: 'POST', body: JSON.stringify({ text }) });

/** postgres.js look-alike: a tagged-template function with `.unsafe(text, values)` → rows array. */
function postgresJsLike(db: PGlite) {
  const sql = (() => { throw new Error('tagged template not supported in this fake'); }) as any;
  sql.unsafe = async (text: string, values?: unknown[]) => (await db.query<Row>(text, values)).rows;
  sql.end = async () => { sql.ended = true; };
  return sql as ((...a: any[]) => any) & { unsafe: (t: string, v?: unknown[]) => Promise<Row[]>; end: () => Promise<void>; ended?: boolean };
}

/** neon() HTTP look-alike: `sql.query(text, values)` → rows array. */
function neonLike(db: PGlite) {
  const sql = (() => { throw new Error('tagged template not supported in this fake'); }) as any;
  sql.query = async (text: string, values?: unknown[]) => (await db.query<Row>(text, values)).rows;
  return sql as ((...a: any[]) => any) & { query: (t: string, v?: unknown[]) => Promise<Row[]> };
}

/** Old neon() look-alike: `sql(text, values)` → rows array, no `.query`. */
function legacyNeonLike(db: PGlite) {
  return async (text: string, values?: unknown[]) => (await db.query<Row>(text, values)).rows;
}

/** pg Pool look-alike: `{ query(text, values) → { rows } }`. */
function pgLike(db: PGlite) {
  return { query: (text: string, values?: unknown[]) => db.query<Row>(text, values), end: async () => {} };
}

const opts = { describe, test, expect };
runDriverConformance('PostgresDriver (PGlite, auto-detected)', () => new PostgresDriver({ client: pg, table: freshTable() }), opts);
runDriverConformance('PostgresDriver (fromPglite)', () => new PostgresDriver({ client: fromPglite(pg), table: freshTable() }), opts);
runDriverConformance('PostgresDriver (pg-style Pool)', () => new PostgresDriver({ client: pgLike(pg), table: freshTable() }), opts);
runDriverConformance('PostgresDriver (postgres.js-style)', () => new PostgresDriver({ client: postgresJsLike(pg), table: freshTable() }), opts);
runDriverConformance('PostgresDriver (neon-style)', () => new PostgresDriver({ client: neonLike(pg), table: freshTable() }), opts);
runDriverConformance('PostgresDriver (legacy neon / QueryFn)', () => new PostgresDriver({ client: legacyNeonLike(pg), table: freshTable() }), opts);

/** Wrap a QueryFn and record every statement. */
function spy(fn: QueryFn) {
  const calls: string[] = [];
  const wrapped: QueryFn = (text, values) => { calls.push(text); return fn(text, values); };
  return { calls, fn: wrapped };
}

describe('client adapters', () => {
  test('fromPg / fromPostgresJs / fromNeon / fromPglite all return rows', async () => {
    for (const q of [fromPg(pgLike(pg)), fromPostgresJs(postgresJsLike(pg)), fromNeon(neonLike(pg)), fromNeon(legacyNeonLike(pg) as any), fromPglite(pg)]) {
      expect(await q('SELECT $1::int + 1 AS n', [41])).toEqual([{ n: 42 }]);
    }
  });

  test('toQueryFn rejects unsupported clients', () => {
    expect(() => toQueryFn({} as any)).toThrow(/Unsupported client/);
  });

  test('fromNeon also accepts { rows } results (fullResults mode)', async () => {
    const sql = Object.assign(() => {}, { query: async () => ({ rows: [{ a: 1 }] }) });
    expect(await fromNeon(sql)('SELECT 1')).toEqual([{ a: 1 }]);
  });
});

describe('PostgresDriver', () => {
  test('migrates lazily, exactly once, even under concurrency', async () => {
    const s = spy(fromPglite(pg));
    const d = new PostgresDriver({ client: s.fn, table: freshTable() });
    expect(s.calls.length).toBe(0);
    await Promise.all([d.set('a', 1), d.set('b', 2), d.get<any>('a')]);
    expect(s.calls.filter((c) => c.startsWith('CREATE')).length).toBe(2); // table + index
    await d.keys();
    expect(s.calls.filter((c) => c.startsWith('CREATE')).length).toBe(2);
  });

  test('entries(prefix) is a single query', async () => {
    const s = spy(fromPglite(pg));
    const d = new PostgresDriver({ client: s.fn, table: freshTable() });
    await d.set('telegram:1:a', 'A');
    await d.set('telegram:1:b', { b: true });
    s.calls.length = 0;
    expect(await d.entries('telegram:1:')).toEqual([['telegram:1:a', 'A'], ['telegram:1:b', { b: true }]]);
    expect(s.calls.length).toBe(1);
  });

  test('stores JSON values, including strings that look like JSON', async () => {
    const d = new PostgresDriver({ client: postgresJsLike(pg), table: freshTable() });
    for (const v of ['{"a":1}', '"quoted"', '', 'ünïcödé 🚀', { nested: { arr: [1, null, 'x'] } }, 1.5, -0.25]) {
      await d.set('k', v);
      expect(await d.get<any>('k')).toEqual(v);
    }
  });

  test('set(undefined) deletes', async () => {
    const d = new PostgresDriver({ client: pg, table: freshTable() });
    await d.set('k', 1);
    await d.set('k', undefined);
    expect(await d.has('k')).toBe(false);
  });

  test('prefix matching is case-sensitive and escapes backslashes', async () => {
    const d = new PostgresDriver({ client: pg, table: freshTable() });
    await d.set('Telegram:1:a', 1);
    await d.set('telegram:1:a', 2);
    await d.set('back\\slash:1', 3);
    await d.set('backXslash:1', 4);
    expect(await d.keys('telegram:')).toEqual(['telegram:1:a']);
    expect(await d.keys('back\\slash:')).toEqual(['back\\slash:1']);
    expect(escapeLike('a%b_c\\')).toBe('a\\%b\\_c\\\\%');
  });

  test('ttl expiry is evaluated in SQL; purgeExpired removes the rows', async () => {
    const table = freshTable();
    const d = new PostgresDriver({ client: pg, table });
    await d.set('short', 1, { ttl: 20 });
    await d.set('long', 2);
    await d.set('later', 3, { ttl: 60_000 });
    await Bun.sleep(40);
    expect(await d.has('short')).toBe(false);
    expect(await d.entries('')).toEqual([['later', 3], ['long', 2]]);
    expect(await d.purgeExpired()).toBe(1);
    expect(await d.purgeExpired()).toBe(0);
    const rows = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
    expect(rows[0].n).toBe(2);
  });

  test('re-setting without ttl clears expires_at', async () => {
    const d = new PostgresDriver({ client: pg, table: freshTable() });
    await d.set('k', 1, { ttl: 10 });
    await d.set('k', 2);
    await Bun.sleep(25);
    expect(await d.get<any>('k')).toBe(2);
  });

  test('schema option creates the table in that schema', async () => {
    await pg.exec('CREATE SCHEMA IF NOT EXISTS bot');
    const d = new PostgresDriver({ client: pg, schema: 'bot', table: 'kv' });
    expect(d.tableRef).toBe('"bot"."kv"');
    await d.set('x', 'y');
    const rows = await d.query(`SELECT key FROM bot.kv`);
    expect(rows).toEqual([{ key: 'x' }]);
  });

  test('autoMigrate: false + createTableSql for hand-run migrations', async () => {
    const table = freshTable();
    const d = new PostgresDriver({ client: pg, table, autoMigrate: false });
    await expect(d.get<any>('x')).rejects.toThrow();
    const ddl = createTableSql(table);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    expect(ddl).toContain('JSONB NOT NULL');
    await pg.exec(ddl);
    await d.set('x', 1);
    expect(await d.get<any>('x')).toBe(1);
    expect(createTableStatements(table, 'bot')[0]).toContain(`"bot"."${table}"`);
  });

  test('migration failure is retried on the next call', async () => {
    let fail = true;
    const base = fromPglite(pg);
    const d = new PostgresDriver({
      table: freshTable(),
      client: async (text: string, values?: unknown[]) => {
        if (fail && text.startsWith('CREATE')) throw new Error('db down');
        return base(text, values);
      },
    });
    await expect(d.set('a', 1)).rejects.toThrow('db down');
    fail = false;
    await d.set('a', 1);
    expect(await d.get<any>('a')).toBe(1);
  });

  test('close() only ends the client when closeClient is set', async () => {
    const shared = postgresJsLike(pg);
    await new PostgresDriver({ client: shared }).close();
    expect(shared.ended).toBeUndefined();
    await new PostgresDriver({ client: shared, closeClient: true }).close();
    expect(shared.ended).toBe(true);
  });

  test('constructor validates options', () => {
    expect(() => new PostgresDriver(undefined as any)).toThrow(/client/);
  });
});

describe('identifier validation', () => {
  test('accepts plain identifiers', () => {
    expect(quotePgIdent('teact_storage')).toBe('"teact_storage"');
  });

  test.each(['', '9x', 'a-b', 'x"; DROP TABLE users; --', 'public.t', 'a'.repeat(64)])('rejects %p', (name) => {
    expect(() => quotePgIdent(name)).toThrow(/Invalid identifier/);
    expect(() => new PostgresDriver({ client: pg, table: name })).toThrow(/Invalid identifier/);
    expect(() => new PostgresDriver({ client: pg, schema: name })).toThrow(/Invalid identifier/);
  });
});

describe('postgres + storagePlugin', () => {
  function Visits() {
    const { messageId } = useBot();
    const [visits, setVisits] = useStorage<{ n: number; last?: string }>('visits', { n: 0 });
    if (visits.last !== messageId) setVisits({ n: visits.n + 1, last: messageId });
    return <Message text={`visits ${visits.n}`} />;
  }

  test('writes are durable before bot.fetch() resolves', async () => {
    const driver = new PostgresDriver({ client: pg, table: freshTable() });
    const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver })] });
    await bot.fetch(post());
    const keys = await driver.keys();
    expect(keys.length).toBe(1);
    expect(keys[0]).toEndWith(':visits');
    expect((await driver.get<{ n: number }>(keys[0]))!.n).toBe(1);
    await bot.stop();
  });

  test('MockAdapter: values persist across updates and are re-read from Postgres', async () => {
    const driver = new PostgresDriver({ client: neonLike(pg), table: freshTable() });
    const adapter = new MockAdapter();
    function Show() {
      const [v] = useStorage<string>('greeting', 'none');
      return <Message text={`greeting=${v}`} />;
    }
    const bot = createBot({ component: Show, adapter, token: 't', plugins: [storagePlugin({ driver })] });
    await bot.start();
    await driver.set('mock:42:greeting', 'hello');
    await adapter.simulateMessage('42', '1', 'x');
    expect(JSON.stringify(adapter.getLastSent())).toContain('greeting=hello');
    await bot.stop();
  });
});

describe('postgres sessions', () => {
  function Seen() {
    const [s, set] = useSession<{ seen?: number }>();
    if (!s.seen) set({ seen: 1 });
    return <Message text="ok" />;
  }

  test('createSessionStore(driver) persists before bot.fetch() resolves', async () => {
    const driver = new PostgresDriver({ client: pg, table: freshTable() });
    const bot = createBot({ component: Seen, adapter: new MockAdapter(), token: 't', session: { store: createSessionStore(driver) } });
    await bot.fetch(post());
    const [key] = await driver.keys('session:');
    expect(await driver.get<any>(key)).toEqual({ seen: 1 });
    await bot.stop();
  });

  test('postgresSessionStore accepts options and honours prefix + ttl', async () => {
    const table = freshTable();
    const store = postgresSessionStore({ client: pg, table }, { prefix: 's:', ttl: 20 });
    await store.set('mock:1', { a: 1 });
    expect(await store.get('mock:1')).toEqual({ a: 1 });
    const direct = new PostgresDriver({ client: pg, table });
    expect(await direct.get<any>('s:mock:1')).toEqual({ a: 1 });
    await Bun.sleep(40);
    expect(await store.get('mock:1')).toBeNull();
    await store.set('mock:2', { b: 2 });
    await store.delete('mock:2');
    expect(await store.get('mock:2')).toBeNull();
  });
});

describe('postgresPlugin', () => {
  test('provides the driver via usePostgres()', async () => {
    const adapter = new MockAdapter();
    function C() {
      const pgd = usePostgres();
      return <Message text={`driver=${pgd instanceof PostgresDriver}`} />;
    }
    const bot = createBot({ component: C, adapter, token: 't', plugins: [postgresPlugin({ client: pg, table: freshTable() })] });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'x');
    expect(JSON.stringify(adapter.getLastSent())).toContain('driver=true');
    await bot.stop();
  });

  test('shares a driver; closeOnStop ends the client', async () => {
    const driver = new PostgresDriver({ client: pg });
    expect(postgresPlugin({ driver }).services?.postgres).toBe(driver);
    expect(postgresPlugin({ driver }).onStop).toBeUndefined();
    const client = postgresJsLike(pg);
    await postgresPlugin({ client, closeOnStop: true }).onStop!();
    expect(client.ended).toBe(true);
  });

  test('requires a client or driver', () => {
    expect(() => postgresPlugin({})).toThrow(/client/);
  });
});
