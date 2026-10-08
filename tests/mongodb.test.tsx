import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, useBot, useSession } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { storagePlugin, useStorage, runDriverConformance } from '../packages/storage/src';
import {
  MongoDriver,
  mongoSessionStore,
  mongoPlugin,
  useMongo,
  escapeRegex,
  type MongoCollectionLike,
} from '../packages/mongodb/src';

// ── A fake `mongodb` Collection implementing the query subset the driver uses ─────────

type Doc = Record<string, any>;

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null) return actual === null || actual === undefined; // Mongo: null matches missing
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$regex': return typeof actual === 'string' && new RegExp(arg as string).test(actual);
        case '$gt': return actual != null && (actual as any) > (arg as any);
        case '$lte': return actual != null && (actual as any) <= (arg as any);
        case '$exists': return (actual !== undefined) === arg;
        case '$in': return (arg as unknown[]).includes(actual);
        default: throw new Error(`fake mongo: unsupported operator ${op}`);
      }
    });
  }
  return actual === cond;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    if (k === '$and') return (cond as Doc[]).every((f) => matches(doc, f));
    if (k.startsWith('$')) throw new Error(`fake mongo: unsupported operator ${k}`);
    return matchValue(doc[k], cond);
  });
}

function project(doc: Doc, projection?: Record<string, 1>): Doc {
  if (!projection) return structuredClone(doc);
  const out: Doc = { _id: doc._id };
  for (const k of Object.keys(projection)) if (k in doc) out[k] = structuredClone(doc[k]);
  return out;
}

/**
 * BSON serialization like the official driver: `undefined` object members become `null`
 * unless `ignoreUndefined` is set (then they are dropped); `undefined` array items are
 * always `null`.
 */
function bson(v: unknown, ignoreUndefined: boolean): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : bson(x, ignoreUndefined)));
  if (v instanceof Date) return new Date(v);
  if (v && typeof v === 'object') {
    const out: Doc = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) { if (!ignoreUndefined) out[k] = null; }
      else out[k] = bson(x, ignoreUndefined);
    }
    return out;
  }
  return v;
}

class FakeCollection implements MongoCollectionLike {
  docs = new Map<string, Doc>();
  indexes: Array<{ spec: Doc; options?: Doc }> = [];
  ops: string[] = [];
  /** Throw a duplicate-key error on the next N upsert-inserts (simulates a concurrent insert). */
  duplicateOnInsert = 0;

  /** Apply $set / $unset / $inc to `doc` (upserting when allowed); returns the doc or null. */
  private apply(filter: Doc, update: Doc, options: { upsert?: boolean; ignoreUndefined?: boolean } = {}) {
    let doc = [...this.docs.values()].find((d) => matches(d, filter));
    if (!doc) {
      if (!options.upsert) return null;
      if (this.duplicateOnInsert > 0) {
        this.duplicateOnInsert--;
        throw Object.assign(new Error('E11000 duplicate key error collection'), { code: 11000 });
      }
      if (this.docs.has(filter._id)) throw Object.assign(new Error('E11000 duplicate key error collection'), { code: 11000 });
      doc = { _id: filter._id };
    }
    for (const op of Object.keys(update)) if (!['$set', '$unset', '$inc'].includes(op)) throw new Error(`unsupported ${op}`);
    const next = { ...doc };
    const ign = !!options.ignoreUndefined;
    for (const [k, v] of Object.entries(update.$set ?? {})) next[k] = v === undefined ? (ign ? undefined : null) : bson(v, ign);
    for (const k of Object.keys(update.$unset ?? {})) delete next[k];
    for (const [k, v] of Object.entries(update.$inc ?? {})) {
      if (next[k] !== undefined && typeof next[k] !== 'number') throw new Error(`Cannot apply $inc to a value of non-numeric type`);
      next[k] = (next[k] ?? 0) + (v as number);
    }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    this.docs.set(next._id, next);
    return next;
  }

  async findOne(filter: Doc, options?: { projection?: Record<string, 1> }) {
    this.ops.push('findOne');
    const doc = [...this.docs.values()].find((d) => matches(d, filter));
    return doc ? project(doc, options?.projection) : null;
  }
  find(filter: Doc, options?: { projection?: Record<string, 1> }) {
    this.ops.push('find');
    const docs = [...this.docs.values()].filter((d) => matches(d, filter)).map((d) => project(d, options?.projection));
    return { toArray: async () => docs };
  }
  async updateOne(filter: Doc, update: Doc, options?: { upsert?: boolean; ignoreUndefined?: boolean }) {
    this.ops.push('updateOne');
    return { matchedCount: this.apply(filter, update, options) ? 1 : 0 };
  }
  /** v6+ shape (resolves the document); `v5: true` mimics driver v5's `{ value, ok }` result. */
  v5 = false;
  async findOneAndUpdate(filter: Doc, update: Doc, options?: { upsert?: boolean; ignoreUndefined?: boolean; returnDocument?: string }) {
    this.ops.push('findOneAndUpdate');
    if (options?.returnDocument !== 'after') throw new Error('expected returnDocument: after');
    const doc = this.apply(filter, update, options);
    const out = doc ? structuredClone(doc) : null;
    return this.v5 ? { value: out, ok: 1 } : out;
  }
  async deleteOne(filter: Doc) {
    const doc = [...this.docs.values()].find((d) => matches(d, filter));
    if (doc) this.docs.delete(doc._id);
    return { deletedCount: doc ? 1 : 0 };
  }
  async deleteMany(filter: Doc) {
    let n = 0;
    for (const d of [...this.docs.values()]) if (matches(d, filter)) { this.docs.delete(d._id); n++; }
    return { deletedCount: n };
  }
  async createIndex(spec: Doc, options?: Doc) {
    this.indexes.push({ spec, options });
    return 'idx';
  }
}

function fakeDb() {
  const collections = new Map<string, FakeCollection>();
  return {
    collections,
    collection(name: string) {
      if (!collections.has(name)) collections.set(name, new FakeCollection());
      return collections.get(name)!;
    },
  };
}

function fakeClient() {
  const dbs = new Map<string, ReturnType<typeof fakeDb>>();
  return {
    closed: 0,
    dbs,
    db(name = 'default') {
      if (!dbs.has(name)) dbs.set(name, fakeDb());
      return dbs.get(name)!;
    },
    async close() { this.closed++; },
  };
}

// ── Conformance ───────────────────────────────────────────────────────────────────────

runDriverConformance('MongoDriver', () => new MongoDriver({ collection: new FakeCollection() }), { describe, test, expect });
runDriverConformance('MongoDriver(driver v5 result shape)', () => new MongoDriver({ collection: Object.assign(new FakeCollection(), { v5: true }) }), { describe, test, expect });
runDriverConformance('MongoDriver(db)', () => new MongoDriver({ db: fakeDb() }), { describe, test, expect });

describe('MongoDriver details', () => {
  test('documents are { _id, value, expiresAt? } and ttl sets/clears expiresAt', async () => {
    const col = new FakeCollection();
    const d = new MongoDriver({ collection: col });
    await d.set('k', { a: 1 }, { ttl: 60_000 });
    const doc = col.docs.get('k')!;
    expect(doc.value).toEqual({ a: 1 });
    expect(doc.expiresAt).toBeInstanceOf(Date);
    expect(doc.expiresAt.getTime() - Date.now()).toBeGreaterThan(50_000);
    await d.set('k', 2);
    expect(col.docs.get('k')).toEqual({ _id: 'k', value: 2 });
  });

  test('undefined object members are dropped (ignoreUndefined), not stored as null', async () => {
    const col = new FakeCollection();
    const d = new MongoDriver({ collection: col });
    await d.set('k', { a: 1, gone: undefined, nested: { x: undefined, y: 2 }, arr: [1, undefined] });
    expect(col.docs.get('k')!.value).toEqual({ a: 1, nested: { y: 2 }, arr: [1, null] });
    expect('gone' in col.docs.get('k')!.value).toBe(false);
    expect(await d.get('k')).toEqual(JSON.parse(JSON.stringify({ a: 1, gone: undefined, nested: { x: undefined, y: 2 }, arr: [1, undefined] })));
    // Sanity check of the fake: without the option the driver default would store null.
    await col.updateOne({ _id: 'raw' }, { $set: { value: { gone: undefined } } }, { upsert: true });
    expect(col.docs.get('raw')!.value).toEqual({ gone: null });
  });

  test('ttl: 0, negative, NaN and Infinity mean no expiry (no Invalid Date)', async () => {
    const col = new FakeCollection();
    const d = new MongoDriver({ collection: col });
    for (const ttl of [0, -1, NaN, Infinity]) {
      await d.set('k', 1, { ttl });
      expect(col.docs.get('k')).toEqual({ _id: 'k', value: 1 });
      await d.incr!('n', 1, { ttl });
      expect(col.docs.get('n')!.expiresAt).toBeUndefined();
    }
  });

  test('incr: $inc on live docs, expired docs reset with the new ttl, retries a duplicate-key race', async () => {
    const col = new FakeCollection();
    const d = new MongoDriver({ collection: col });
    expect(await d.incr!('n', 2, { ttl: 60_000 })).toBe(2);
    const exp = col.docs.get('n')!.expiresAt.getTime();
    expect(await d.incr!('n', 0.5, { ttl: 5 })).toBe(2.5);
    expect(col.docs.get('n')!.expiresAt.getTime()).toBe(exp); // keeps its first expiry
    col.docs.set('old', { _id: 'old', value: 99, expiresAt: new Date(Date.now() - 1000) });
    expect(await d.incr!('old', 1)).toBe(1);
    expect(col.docs.get('old')).toEqual({ _id: 'old', value: 1 });
    col.duplicateOnInsert = 1;
    expect(await d.incr!('race')).toBe(1);
    await d.set('s', 'text');
    await expect(d.incr!('s')).rejects.toThrow('non-numeric');
    await expect(d.incr!('s', NaN)).rejects.toThrow('finite');
    const noFindAndModify = { ...new FakeCollection(), findOneAndUpdate: undefined } as unknown as MongoCollectionLike;
    expect(new MongoDriver({ collection: noFindAndModify }).incr).toBeUndefined();
  });

  test('expired documents are filtered on read even before the TTL monitor deletes them', async () => {
    const col = new FakeCollection();
    col.docs.set('p:old', { _id: 'p:old', value: 1, expiresAt: new Date(Date.now() - 1000) });
    col.docs.set('p:new', { _id: 'p:new', value: 2, expiresAt: new Date(Date.now() + 60_000) });
    const d = new MongoDriver({ collection: col });
    expect(await d.get('p:old')).toBeUndefined();
    expect(await d.has('p:old')).toBe(false);
    expect(await d.keys('p:')).toEqual(['p:new']);
    expect(await d.entries('p:')).toEqual([['p:new', 2]]);
  });

  test('entries() is one find() query', async () => {
    const col = new FakeCollection();
    const d = new MongoDriver({ collection: col });
    for (let i = 0; i < 5; i++) await d.set(`c:${i}`, i);
    col.ops = [];
    expect((await d.entries('c:')).length).toBe(5);
    expect(col.ops).toEqual(['find']);
  });

  test('prefix regex is anchored and escaped', () => {
    expect(escapeRegex('a.b*c(d)[e]^$|?+{}\\')).toBe('a\\.b\\*c\\(d\\)\\[e\\]\\^\\$\\|\\?\\+\\{\\}\\\\');
    expect(new RegExp('^' + escapeRegex('x.y:')).test('xzy:1')).toBe(false);
  });

  test('ensureIndexes creates a TTL index on expiresAt', async () => {
    const col = new FakeCollection();
    await new MongoDriver({ collection: col }).ensureIndexes();
    expect(col.indexes).toEqual([{ spec: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'teact_expiresAt_ttl' } }]);
  });

  test('client + dbName + collectionName, closeClient', async () => {
    const client = fakeClient();
    const d = new MongoDriver({ client, dbName: 'bot', collectionName: 'kv', closeClient: true });
    await d.set('a', 1);
    expect(client.dbs.get('bot')!.collections.get('kv')!.docs.get('a')!.value).toBe(1);
    await d.close();
    expect(client.closed).toBe(1);
    await new MongoDriver({ client }).close();
    expect(client.closed).toBe(1); // default: don't close a client you didn't ask to
    expect(() => new MongoDriver({})).toThrow('needs a');
  });
});

describe('mongoSessionStore', () => {
  test('prefix + ttl', async () => {
    const db = fakeDb();
    const store = mongoSessionStore({ db, collectionName: 'sessions', ttl: 20 });
    await store.set('telegram:1', { step: 1 });
    expect(db.collections.get('sessions')!.docs.get('session:telegram:1')!.value).toEqual({ step: 1 });
    expect(await store.get('telegram:1')).toEqual({ step: 1 });
    await new Promise((r) => setTimeout(r, 40));
    expect(await store.get('telegram:1')).toBeNull();
  });

  test('works as createBot session store', async () => {
    const col = new FakeCollection();
    function C() {
      const [s, set] = useSession<{ seen?: boolean }>();
      if (!s.seen) set({ seen: true });
      return <Message text="ok" />;
    }
    const bot = createBot({ component: C, adapter: new MockAdapter(), token: 't', session: { store: mongoSessionStore({ collection: col }) } });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    const [doc] = [...col.docs.values()];
    expect(doc._id).toStartWith('session:');
    expect(doc.value).toEqual({ seen: true });
    await bot.stop();
  });
});

describe('storagePlugin + MongoDriver (integration)', () => {
  function Visits() {
    const { messageId } = useBot();
    const [visits, setVisits] = useStorage<{ n: number; last?: string }>('visits', { n: 0 });
    if (visits.last !== messageId) setVisits({ n: visits.n + 1, last: messageId });
    return <Message text={`visits ${visits.n}`} />;
  }

  test('writes are durable before bot.fetch() resolves', async () => {
    const col = new FakeCollection();
    const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver: new MongoDriver({ collection: col }) })] });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    const docs = [...col.docs.values()];
    expect(docs.length).toBe(1);
    expect(docs[0]._id).toStartWith('mock:');
    expect(docs[0]._id).toEndWith(':visits');
    expect(docs[0].value.n).toBe(1);
    await bot.stop();
  });
});

describe('mongoPlugin', () => {
  test('provides the Db via useMongo(); closeOnStop: true closes the client on stop', async () => {
    const client = fakeClient();
    client.db('bot').collection('users').docs.set('u1', { _id: 'u1', name: 'Ada' });
    function App() {
      const db = useMongo<ReturnType<typeof fakeDb>>();
      return <Message text={`users=${db.collection('users').docs.size}`} />;
    }
    const adapter = new MockAdapter();
    const bot = createBot({ component: App, adapter, token: 't', plugins: [mongoPlugin({ client, dbName: 'bot', closeOnStop: true })] });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'x');
    expect(JSON.stringify(adapter.getLastSent())).toContain('users=1');
    await bot.stop();
    expect(client.closed).toBe(1);
  });

  test('a given client is left open by default', async () => {
    const client = fakeClient();
    const bot = createBot({ component: () => <Message text="x" />, adapter: new MockAdapter(), token: 't', plugins: [mongoPlugin({ client })] });
    await bot.start();
    await bot.stop();
    expect(client.closed).toBe(0);
    expect(() => mongoPlugin({})).toThrow('needs a');
  });
});
