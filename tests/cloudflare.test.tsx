import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import React from 'react';
import { createBot, useBot, useSession } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { storagePlugin, useStorage, runDriverConformance } from '../packages/storage/src';
import {
  KVDriver,
  D1Driver,
  kvSessionStore,
  d1SessionStore,
  kvExpirationTtl,
  escapeLike,
  type KVNamespaceLike,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
} from '../packages/cloudflare/src';

// ── Fake Workers KV (paginated list, expirationTtl validation) ─────────────────────────

class FakeKV implements KVNamespaceLike {
  data = new Map<string, { value: string; expiration?: number }>();
  puts: Array<{ key: string; options?: { expirationTtl?: number } }> = [];
  ops: string[] = [];
  /** Small page size so list() pagination is exercised (real KV: 1000). */
  pageSize = 2;

  private live(key: string) {
    const e = this.data.get(key);
    if (e?.expiration !== undefined && Date.now() / 1000 >= e.expiration) { this.data.delete(key); return undefined; }
    return e;
  }
  async get(key: string, type: 'text') {
    this.ops.push('get');
    if (type !== 'text') throw new Error('unexpected type');
    return this.live(key)?.value ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.ops.push('put');
    if (typeof value !== 'string') throw new Error('KV put: value must be a string');
    if (options?.expirationTtl !== undefined && (options.expirationTtl < 60 || !Number.isInteger(options.expirationTtl))) {
      throw new Error('KV PUT failed: 400 Invalid expiration_ttl of ' + options.expirationTtl);
    }
    this.puts.push({ key, options });
    this.data.set(key, { value, expiration: options?.expirationTtl ? Date.now() / 1000 + options.expirationTtl : undefined });
  }
  async delete(key: string) { this.ops.push('delete'); this.data.delete(key); }
  async list(options: { prefix?: string | null; cursor?: string | null; limit?: number } = {}) {
    this.ops.push('list');
    const prefix = options.prefix ?? '';
    const all = [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.live(k)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = all.slice(start, start + this.pageSize);
    const done = start + this.pageSize >= all.length;
    return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + this.pageSize) };
  }
}

// ── Fake D1 on top of bun:sqlite, so the driver's real SQL runs ───────────────────────

function fakeD1(sqlite = new Database(':memory:')) {
  const log: string[] = [];
  const statement = (sql: string, params: unknown[] = []): D1PreparedStatementLike & { sql: string; params: unknown[] } => ({
    sql,
    params,
    bind(...values: unknown[]) {
      if (values.some((v) => v === undefined)) throw new Error('D1_TYPE_ERROR: Type undefined is not supported');
      return statement(sql, values);
    },
    async first<T>() {
      log.push(sql);
      return ((sqlite.query(sql).get(...(params as any[])) as T | undefined) ?? null) as T | null;
    },
    async run() {
      log.push(sql);
      sqlite.query(sql).run(...(params as any[]));
      return { success: true };
    },
    async all<T>() {
      log.push(sql);
      return { results: sqlite.query(sql).all(...(params as any[])) as T[] };
    },
  });
  const db: D1DatabaseLike & { sqlite: Database; log: string[] } = {
    sqlite,
    log,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      return sqlite.transaction(() => stmts.map((s: any) => sqlite.query(s.sql).run(...s.params)))();
    },
  };
  return db;
}

// ── Conformance ───────────────────────────────────────────────────────────────────────

const opts = { describe, test, expect };
// KV can't expire anything faster than 60s, so its TTL behaviour is tested separately below.
runDriverConformance('KVDriver', () => new KVDriver(new FakeKV()), { ...opts, skipTtl: true });
runDriverConformance('KVDriver(lazy getter + namespace)', () => { const kv = new FakeKV(); return new KVDriver(() => kv, { namespace: 'bot:' }); }, { ...opts, skipTtl: true });
runDriverConformance('D1Driver', () => new D1Driver(fakeD1()), opts);
runDriverConformance('D1Driver(lazy getter + custom table)', () => { const db = fakeD1(); return new D1Driver(() => db, { table: 'my_kv' }); }, opts);

describe('KVDriver details', () => {
  test('ttl is converted to expirationTtl seconds, rounded up with a 60s floor', async () => {
    const kv = new FakeKV();
    const d = new KVDriver(kv);
    await d.set('a', 1, { ttl: 30 });
    await d.set('b', 1, { ttl: 90_001 });
    await d.set('c', 1);
    expect(kv.puts.map((p) => p.options)).toEqual([{ expirationTtl: 60 }, { expirationTtl: 91 }, undefined]);
    expect(kvExpirationTtl(1)).toBe(60);
    expect(kvExpirationTtl(60_000)).toBe(60);
    expect(kvExpirationTtl(3_600_000)).toBe(3600);
  });

  test('expired KV entries are not returned', async () => {
    const kv = new FakeKV();
    kv.data.set('gone', { value: '"x"', expiration: Date.now() / 1000 - 1 });
    const d = new KVDriver(kv);
    expect(await d.get('gone')).toBeUndefined();
    expect(await d.keys()).toEqual([]);
  });

  test('entries() pages through list() and fetches values in parallel', async () => {
    const kv = new FakeKV();
    const d = new KVDriver(kv);
    for (let i = 0; i < 5; i++) await d.set(`p:${i}`, i);
    await d.set('q:0', 'other');
    kv.ops = [];
    const entries = (await d.entries('p:')).sort(([a], [b]) => a.localeCompare(b));
    expect(entries).toEqual([0, 1, 2, 3, 4].map((i) => [`p:${i}`, i]));
    expect(kv.ops.filter((o) => o === 'list').length).toBe(3);
    expect(kv.ops.filter((o) => o === 'get').length).toBe(5);
  });

  test('a stored null is distinct from a missing key', async () => {
    const d = new KVDriver(new FakeKV());
    await d.set('n', null);
    expect(await d.get('n')).toBeNull();
    expect(await d.has('n')).toBe(true);
    expect(await d.has('missing')).toBe(false);
  });

  test('the lazy getter is resolved at call time, not construction', async () => {
    let kv: FakeKV | undefined;
    const d = new KVDriver(() => kv!);
    kv = new FakeKV();
    await d.set('x', 1);
    expect(kv.data.get('x')!.value).toBe('1');
  });
});

describe('D1Driver details', () => {
  test('creates the table lazily, once', async () => {
    const db = fakeD1();
    const d = new D1Driver(db);
    expect(db.log).toEqual([]);
    await d.set('a', 1);
    await d.get('a');
    await d.keys();
    expect(db.log.filter((s) => s.startsWith('CREATE TABLE')).length).toBe(1);
    const cols = db.sqlite.query('PRAGMA table_info(teact_storage)').all() as Array<{ name: string; type: string; pk: number }>;
    expect(cols.map((c) => [c.name, c.type, c.pk])).toEqual([['key', 'TEXT', 1], ['value', 'TEXT', 0], ['expires_at', 'INTEGER', 0]]);
  });

  test('prefix queries are case-sensitive despite SQLite LIKE', async () => {
    const d = new D1Driver(fakeD1());
    await d.set('Chat:1', 'upper');
    await d.set('chat:1', 'lower');
    expect(await d.keys('chat:')).toEqual(['chat:1']);
    await d.clear('chat:');
    expect(await d.keys()).toEqual(['Chat:1']);
  });

  test('escapeLike escapes % _ and backslash', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  test('stores JSON text and epoch-ms expiry; purgeExpired removes expired rows', async () => {
    const db = fakeD1();
    const d = new D1Driver(db);
    await d.set('k', { a: [1] }, { ttl: 1 });
    await d.set('keep', true);
    const row = db.sqlite.query('SELECT value, expires_at FROM teact_storage WHERE key = ?').get('k') as any;
    expect(row.value).toBe('{"a":[1]}');
    expect(row.expires_at).toBeGreaterThan(Date.now() - 1000);
    await new Promise((r) => setTimeout(r, 10));
    await d.purgeExpired();
    expect((db.sqlite.query('SELECT key FROM teact_storage').all() as any[]).map((r) => r.key)).toEqual(['keep']);
  });

  test('entries() is a single SELECT', async () => {
    const db = fakeD1();
    const d = new D1Driver(db);
    await d.set('p:1', 1);
    await d.set('p:2', 2);
    db.log.length = 0;
    expect((await d.entries('p:')).length).toBe(2);
    expect(db.log.length).toBe(1);
  });

  test('rejects unsafe table names; retries table creation after a failure', async () => {
    expect(() => new D1Driver(fakeD1(), { table: 'x; DROP TABLE y' })).toThrow('Invalid D1 table name');
    const db = fakeD1();
    let fail = true;
    const flaky: D1DatabaseLike = {
      prepare(sql) {
        if (fail && sql.startsWith('CREATE')) { fail = false; return { ...db.prepare(sql), run: async () => { throw new Error('network'); } }; }
        return db.prepare(sql);
      },
      batch: db.batch,
    };
    const d = new D1Driver(flaky);
    await expect(d.set('a', 1)).rejects.toThrow('network');
    await d.set('a', 1);
    expect(await d.get<number>('a')).toBe(1);
  });
});

describe('session stores', () => {
  test('kvSessionStore: prefix and rounded ttl', async () => {
    const kv = new FakeKV();
    const store = kvSessionStore(kv, { ttl: 5000 });
    await store.set('telegram:1', { step: 1 });
    expect(kv.puts[0]).toEqual({ key: 'session:telegram:1', options: { expirationTtl: 60 } });
    expect(await store.get('telegram:1')).toEqual({ step: 1 });
    await store.delete('telegram:1');
    expect(await store.get('telegram:1')).toBeNull();
  });

  test('d1SessionStore: prefix + ttl expiry', async () => {
    const store = d1SessionStore(fakeD1(), { prefix: 's:', ttl: 20 });
    await store.set('telegram:1', { a: 1 });
    expect(await store.get('telegram:1')).toEqual({ a: 1 });
    await new Promise((r) => setTimeout(r, 40));
    expect(await store.get('telegram:1')).toBeNull();
  });

  test('d1SessionStore works as createBot session store', async () => {
    const db = fakeD1();
    function C() {
      const [s, set] = useSession<{ seen?: boolean }>();
      if (!s.seen) set({ seen: true });
      return <Message text="ok" />;
    }
    const bot = createBot({ component: C, adapter: new MockAdapter(), token: 't', session: { store: d1SessionStore(() => db) } });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    const rows = db.sqlite.query('SELECT key, value FROM teact_storage').all() as Array<{ key: string; value: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].key).toStartWith('session:');
    expect(JSON.parse(rows[0].value)).toEqual({ seen: true });
    await bot.stop();
  });
});

describe('storagePlugin integration', () => {
  function Visits() {
    const { messageId } = useBot();
    const [visits, setVisits] = useStorage<{ n: number; last?: string }>('visits', { n: 0 });
    if (visits.last !== messageId) setVisits({ n: visits.n + 1, last: messageId });
    return <Message text={`visits ${visits.n}`} />;
  }
  const req = () => new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) });

  test('KVDriver: writes are durable before bot.fetch() resolves', async () => {
    const kv = new FakeKV();
    const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver: new KVDriver(() => kv) })] });
    await bot.fetch(req());
    const keys = [...kv.data.keys()];
    expect(keys.length).toBe(1);
    expect(keys[0]).toStartWith('mock:');
    expect(keys[0]).toEndWith(':visits');
    expect(JSON.parse(kv.data.get(keys[0])!.value).n).toBe(1);
    await bot.stop();
  });

  test('D1Driver: writes are durable before bot.fetch() resolves, and accumulate', async () => {
    const db = fakeD1();
    const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver: new D1Driver(db) })] });
    await bot.fetch(req());
    let rows = db.sqlite.query('SELECT key, value FROM teact_storage').all() as Array<{ key: string; value: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].key).toEndWith(':visits');
    expect(JSON.parse(rows[0].value).n).toBe(1);
    await bot.fetch(req());
    rows = db.sqlite.query('SELECT key, value FROM teact_storage').all() as Array<{ key: string; value: string }>;
    expect(JSON.parse(rows[0].value).n).toBe(2);
    await bot.stop();
  });
});
