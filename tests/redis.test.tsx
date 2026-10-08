import { describe, test, expect } from 'bun:test';
import { RedisClient } from 'bun';
import React from 'react';
import { createBot, useBot, useSession } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { storagePlugin, useStorage, runDriverConformance } from '../packages/storage/src';
import {
  RedisDriver,
  redisSessionStore,
  redisPlugin,
  useRedis,
  escapeGlob,
  fromIoredis,
  fromNodeRedis,
  fromBunRedis,
  fromUpstash,
  detectRedisClient,
  toRedisCommands,
  markNormalized,
  type RedisCommands,
  type BunRedisLike,
} from '../packages/redis/src';
import { INCR_SCRIPT } from '../packages/redis/src/client';

// Compile-time check: Bun's real RedisClient satisfies the structural interface.
const _bunClientIsAssignable: BunRedisLike = null as unknown as RedisClient;
void _bunClientIsAssignable;

// ── A fake Redis server + client facades shaped like each library ─────────────────────

/** Redis-style glob → RegExp (supports `* ? [..]` and backslash escapes). */
function globToRegExp(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '\\') re += escapeRe(glob[++i] ?? '');
    else if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      re += '[' + glob.slice(i + 1, end).replace(/\\/g, '\\\\') + ']';
      i = end;
    } else re += escapeRe(ch);
  }
  return new RegExp(re + '$', 's');
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class FakeRedisServer {
  data = new Map<string, { v: string; exp?: number }>();
  commands: string[] = [];
  /** Small page size so SCAN pagination is exercised. */
  pageSize = 3;

  private live(k: string) {
    const e = this.data.get(k);
    if (e?.exp !== undefined && Date.now() >= e.exp) { this.data.delete(k); return undefined; }
    return e;
  }
  get(k: string) { this.commands.push('GET'); return this.live(k)?.v ?? null; }
  mget(keys: string[]) { this.commands.push('MGET'); return keys.map((k) => this.live(k)?.v ?? null); }
  set(k: string, v: string, px?: number) {
    this.commands.push(px ? 'SET PX' : 'SET');
    if (typeof v !== 'string') throw new Error('ERR value must be a string');
    this.data.set(k, { v, exp: px ? Date.now() + px : undefined });
  }
  del(keys: string[]) { this.commands.push('DEL'); let n = 0; for (const k of keys) if (this.data.delete(k)) n++; return n; }
  exists(keys: string[]) { return keys.filter((k) => this.live(k)).length; }
  /** Emulates `EVAL INCR_SCRIPT 1 key by ttl` (GET + INCRBY/INCRBYFLOAT + PEXPIRE when created). */
  eval(script: string, keys: string[], args: string[]): number | string {
    this.commands.push('EVAL');
    if (script !== INCR_SCRIPT) throw new Error('NOSCRIPT unexpected script');
    if (!args.every((a) => typeof a === 'string')) throw new Error('ERR args must be strings');
    const [key] = keys;
    const [by, ttl] = args;
    const e = this.live(key);
    const float = /[.eE]/.test(by) || (!!e && !/^-?\d+$/.test(e.v));
    const cur = e ? Number(e.v) : 0;
    if (e && (!/^-?\d+(\.\d+)?$/.test(e.v) || (!float && !Number.isInteger(cur)))) throw new Error('ERR value is not an integer or out of range');
    const v = cur + Number(by);
    this.data.set(key, { v: String(v), exp: e ? e.exp : Number(ttl) > 0 ? Date.now() + Number(ttl) : undefined });
    return float ? String(v) : v;
  }
  scan(cursor: number, match = '*', count = 10): [string, string[]] {
    this.commands.push('SCAN');
    if (match === '*' && this.commands.includes('KEYS')) throw new Error('unreachable');
    const all = [...this.data.keys()].filter((k) => this.live(k));
    const re = globToRegExp(match);
    const step = Math.min(count, this.pageSize);
    const page = all.slice(cursor, cursor + step).filter((k) => re.test(k));
    const next = cursor + step >= all.length ? 0 : cursor + step;
    return [String(next), page];
  }
}

/** ioredis shape: positional `SET k v PX ms`, `scan(cursor, 'MATCH', p, 'COUNT', n)` → [cursor, keys]. */
function fakeIoredis(s = new FakeRedisServer()) {
  return {
    server: s,
    status: 'ready',
    quitted: 0,
    async get(k: string) { return s.get(k); },
    async mget(...keys: string[]) { return s.mget(keys); },
    async set(k: string, v: string, ...args: any[]) {
      if (args.length && args[0] !== 'PX') throw new Error('expected PX');
      s.set(k, v, args[1]);
      return 'OK';
    },
    async del(...keys: string[]) { return s.del(keys); },
    async scan(cursor: string | number, ...args: any[]): Promise<[string, string[]]> {
      const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
      return s.scan(Number(cursor), opt('MATCH'), opt('COUNT'));
    },
    async eval(script: string, numKeys: number, ...rest: string[]) {
      return s.eval(script, rest.slice(0, numKeys), rest.slice(numKeys));
    },
    scanStream() { throw new Error('not used'); },
    async keys() { throw new Error('KEYS must never be used'); },
    async quit() { this.quitted++; return 'OK'; },
  };
}

/**
 * ioredis `Cluster` shape: no `scanStream`, `isCluster`, `nodes('master')`; keys are spread
 * over several masters and multi-key MGET/DEL across masters fails with CROSSSLOT.
 */
function fakeIoredisCluster(masters = 3) {
  const servers = Array.from({ length: masters }, () => new FakeRedisServer());
  const slot = (k: string) => { let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % masters; };
  const at = (k: string) => servers[slot(k)];
  const sameSlot = (keys: string[]) => {
    if (new Set(keys.map(slot)).size > 1) throw new Error("CROSSSLOT Keys in request don't hash to the same slot");
  };
  const nodes = servers.map((s) => fakeIoredis(s));
  return {
    servers,
    isCluster: true as const,
    quitted: 0,
    nodes(role?: string) { if (role !== 'master') throw new Error('expected master'); return nodes; },
    async get(k: string) { return at(k).get(k); },
    async mget(...keys: string[]) { sameSlot(keys); return at(keys[0]).mget(keys); },
    async set(k: string, v: string, ...args: any[]) { at(k).set(k, v, args[1]); return 'OK'; },
    async del(...keys: string[]) { sameSlot(keys); return at(keys[0]).del(keys); },
    // A cluster's own scan() only reaches one random node — must not be used.
    async scan(): Promise<[string, string[]]> { throw new Error('single-node SCAN on a cluster'); },
    async eval(script: string, numKeys: number, ...rest: string[]) {
      return at(rest[0]).eval(script, rest.slice(0, numKeys), rest.slice(numKeys));
    },
    async quit() { this.quitted++; return 'OK'; },
  };
}

/** node-redis v4 shape: `set(k, v, { PX })`, `scan(cursor, { MATCH, COUNT })` → { cursor: number, keys }, `mGet([])`. */
function fakeNodeRedis(s = new FakeRedisServer(), version: 4 | 5 = 4) {
  return {
    server: s,
    isOpen: true,
    closed: 0,
    async get(k: string) { return s.get(k); },
    async mGet(keys: string[]) {
      if (!Array.isArray(keys)) throw new Error('mGet takes an array');
      return s.mget(keys);
    },
    async set(k: string, v: string, opts?: { PX?: number }) { s.set(k, v, opts?.PX); return 'OK'; },
    async del(keys: string | string[]) { return s.del(Array.isArray(keys) ? keys : [keys]); },
    async scan(cursor: string | number, opts: { MATCH?: string; COUNT?: number }) {
      const [next, keys] = s.scan(Number(cursor), opts.MATCH, opts.COUNT);
      return { cursor: version === 4 ? Number(next) : next, keys };
    },
    async eval(script: string, o: { keys?: string[]; arguments?: string[] }) {
      return s.eval(script, o.keys ?? [], o.arguments ?? []);
    },
    async keys() { throw new Error('KEYS must never be used'); },
    async quit() { this.closed++; return 'OK'; },
    ...(version === 5 ? { async close(this: any) { this.closed++; } } : {}),
  };
}

/** Bun RedisClient shape: generic `send(cmd, args)` plus a few typed helpers. */
function fakeBunRedis(s = new FakeRedisServer()) {
  return {
    server: s,
    connected: true,
    closed: 0,
    async get(k: string) { return s.get(k); },
    async mget(...keys: string[]) { return s.mget(keys); },
    async del(...keys: string[]) { return s.del(keys); },
    async send(cmd: string, args: string[]) {
      if (!args.every((a) => typeof a === 'string')) throw new Error('send() args must be strings');
      switch (cmd) {
        case 'SET': {
          const [k, v, px, ms] = args;
          if (px !== undefined && px !== 'PX') throw new Error('expected PX');
          s.set(k, v, ms ? Number(ms) : undefined);
          return 'OK';
        }
        case 'SCAN': {
          const [cursor, , match, , count] = args;
          return s.scan(Number(cursor), match, Number(count));
        }
        case 'MGET': return s.mget(args);
        case 'EVAL': {
          const [script, n, ...rest] = args;
          return s.eval(script, rest.slice(0, Number(n)), rest.slice(Number(n)));
        }
        default: throw new Error('unexpected ' + cmd);
      }
    },
    close() { this.closed++; },
  };
}

/** @upstash/redis shape: auto-JSON-deserializes values, `set(k, v, { px })`, `scan(c, { match, count })`. */
function fakeUpstash(s = new FakeRedisServer(), automaticDeserialization = true) {
  const parse = (v: string | null) => {
    if (v === null || !automaticDeserialization) return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  return {
    server: s,
    opts: { automaticDeserialization },
    client: { request: async () => ({}) },
    async get(k: string) { return parse(s.get(k)); },
    async mget(...keys: string[]) { return s.mget(keys).map(parse); },
    async set(k: string, v: unknown, opts?: { px?: number }) {
      s.set(k, typeof v === 'string' ? v : JSON.stringify(v), opts?.px);
      return 'OK';
    },
    async del(...keys: string[]) { return s.del(keys); },
    async exists(...keys: string[]) { return s.exists(keys); },
    async eval(script: string, keys: string[], args: string[]) { return parse(String(s.eval(script, keys, args))); },
    async scan(cursor: string | number, opts: { match?: string; count?: number }) {
      const [next, keys] = s.scan(Number(cursor), opts.match, opts.count);
      return [Number(next), keys] as [number, string[]];
    },
    async keys() { throw new Error('KEYS must never be used'); },
  };
}

// ── Conformance: every adapter, raw (auto-detected) and wrapped ───────────────────────

const opts = { describe, test, expect };
runDriverConformance('RedisDriver(ioredis, auto)', () => new RedisDriver({ client: fakeIoredis() }), opts);
runDriverConformance('RedisDriver(fromIoredis)', () => new RedisDriver({ client: fromIoredis(fakeIoredis()) }), opts);
runDriverConformance('RedisDriver(node-redis v4)', () => new RedisDriver({ client: fakeNodeRedis(undefined, 4) }), opts);
runDriverConformance('RedisDriver(node-redis v5)', () => new RedisDriver({ client: fromNodeRedis(fakeNodeRedis(undefined, 5)) }), opts);
runDriverConformance('RedisDriver(bun)', () => new RedisDriver({ client: fakeBunRedis() }), opts);
runDriverConformance('RedisDriver(upstash)', () => new RedisDriver({ client: fakeUpstash() }), opts);
runDriverConformance('RedisDriver(upstash, no auto-deserialize)', () => new RedisDriver({ client: fakeUpstash(undefined, false) }), opts);
runDriverConformance('RedisDriver(ioredis Cluster, auto)', () => new RedisDriver({ client: fakeIoredisCluster() }), opts);
runDriverConformance('RedisDriver(namespace)', () => new RedisDriver({ client: fakeIoredis(), namespace: 'bot*[1]:' }), opts);

describe('RedisDriver details', () => {
  test('detectRedisClient recognizes each library shape', () => {
    expect(detectRedisClient(fakeIoredis())).toBe('ioredis');
    expect(detectRedisClient(fakeNodeRedis())).toBe('node-redis');
    expect(detectRedisClient(fakeBunRedis())).toBe('bun');
    expect(detectRedisClient(fakeUpstash())).toBe('upstash');
    const real = new RedisClient('redis://127.0.0.1:1', { autoReconnect: false, enableOfflineQueue: false });
    expect(detectRedisClient(real)).toBe('bun'); // real Bun client, never connected
    real.close();
    expect(detectRedisClient(fakeIoredisCluster())).toBe('ioredis');
    expect(detectRedisClient(fromIoredis(fakeIoredis()))).toBeUndefined();
    expect(() => toRedisCommands({} as any)).toThrow('Could not recognize');
    // An unknown raw client with get/set/del/scan must not be mistaken for RedisCommands.
    const raw = { get: async () => null, set: async () => 'OK', del: async () => 0, scan: async () => ['0', []] };
    expect(() => toRedisCommands(raw as any)).toThrow('Could not recognize');
  });

  test('ioredis Cluster: scans every master, never multi-key MGET/DEL across slots', async () => {
    const c = fakeIoredisCluster();
    const d = new RedisDriver({ client: c, namespace: 'app:' });
    for (let i = 0; i < 30; i++) await d.set(`p:${i}`, i);
    expect(c.servers.every((s) => s.data.size > 0)).toBe(true); // spread over the masters
    expect((await d.keys('p:')).length).toBe(30);
    expect((await d.entries('p:')).sort(([, a], [, b]) => (a as number) - (b as number)).map(([, v]) => v))
      .toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(await d.incr!('n', 2)).toBe(2);
    await d.clear('p:');
    expect(await d.keys()).toEqual(['n']);
    await new RedisDriver({ client: c, closeClient: true }).close();
    expect(c.quitted).toBe(1);
  });

  test('escapeGlob escapes * ? [ ] and backslash', () => {
    expect(escapeGlob('a*b?c[d]e\\f')).toBe('a\\*b\\?c\\[d\\]e\\\\f');
    expect(globToRegExp(escapeGlob('a*?[b]\\') + '*').test('a*?[b]\\xyz')).toBe(true);
    expect(globToRegExp(escapeGlob('a*') + '*').test('abc')).toBe(false);
  });

  test('values are stored as JSON strings with PX ttl', async () => {
    const c = fakeIoredis();
    const d = new RedisDriver({ client: c, namespace: 'ns:' });
    await d.set('k', { a: 1 }, { ttl: 1500 });
    const raw = c.server.data.get('ns:k')!;
    expect(raw.v).toBe('{"a":1}');
    expect(raw.exp! - Date.now()).toBeGreaterThan(1000);
    expect(c.server.commands).toContain('SET PX');
  });

  test('entries() uses SCAN + one MGET, never KEYS or per-key GET', async () => {
    const c = fakeNodeRedis();
    const d = new RedisDriver({ client: c });
    for (let i = 0; i < 10; i++) await d.set(`p:${i}`, i);
    await d.set('other', 1);
    c.server.commands = [];
    const entries = await d.entries('p:');
    expect(entries.length).toBe(10);
    expect(c.server.commands.filter((x) => x === 'MGET').length).toBe(1);
    expect(c.server.commands).not.toContain('GET');
    expect(c.server.commands.filter((x) => x === 'SCAN').length).toBeGreaterThan(1); // paginated
  });

  test('tolerates plain (non-JSON) strings written by other code', async () => {
    const c = fakeIoredis();
    c.server.set('legacy', 'hello world');
    expect(await new RedisDriver({ client: c }).get<string>('legacy')).toBe('hello world');
  });

  test('upstash: string values that look like JSON survive auto-deserialization', async () => {
    const d = new RedisDriver({ client: fakeUpstash() });
    await d.set('s', '42');
    await d.set('n', null);
    expect(await d.get<string>('s')).toBe('42');
    expect(await d.get('n')).toBeNull();
    expect(await d.has('n')).toBe(true);
    expect(await d.entries('')).toContainEqual(['s', '42']);
  });

  test('clear() with a namespace leaves other keys alone', async () => {
    const c = fakeIoredis();
    c.server.set('foreign', '1');
    const d = new RedisDriver({ client: c, namespace: 'mine:' });
    await d.set('a', 1);
    await d.clear();
    expect([...c.server.data.keys()]).toEqual(['foreign']);
  });

  test('close() leaves a given client open by default; closeClient: true closes it once', async () => {
    const io = fakeIoredis();
    const d = new RedisDriver({ client: io, closeClient: true });
    await d.close();
    await d.close();
    expect(io.quitted).toBe(1);

    const v5 = fakeNodeRedis(undefined, 5);
    await new RedisDriver({ client: v5, closeClient: true }).close();
    expect(v5.closed).toBe(1);

    const bun = fakeBunRedis();
    await new RedisDriver({ client: bun }).close();
    expect(bun.closed).toBe(0);
  });

  test('ttl: 0, negative, NaN and Infinity mean no expiry (plain SET, no throw)', async () => {
    const c = fakeBunRedis();
    const d = new RedisDriver({ client: c });
    for (const ttl of [0, -1, NaN, Infinity]) await d.set('k', 1, { ttl });
    expect(c.server.commands.filter((x) => x === 'SET PX')).toEqual([]);
    expect(c.server.data.get('k')!.exp).toBeUndefined();
  });

  test('incr: one EVAL round trip per call, ttl only on creation, works for every adapter', async () => {
    for (const make of [fakeIoredis, fakeNodeRedis, fakeBunRedis, fakeUpstash] as const) {
      const c = make();
      const d = new RedisDriver({ client: c, namespace: 'ns:' });
      c.server.commands = [];
      expect(await d.incr!('n', 1, { ttl: 5000 })).toBe(1);
      expect(c.server.commands).toEqual(['EVAL']);
      const exp = c.server.data.get('ns:n')!.exp!;
      expect(exp).toBeGreaterThan(Date.now());
      expect(await d.incr!('n', 4, { ttl: 999_999 })).toBe(5);
      expect(c.server.data.get('ns:n')!.exp).toBe(exp);
      expect(await d.get<number>('n')).toBe(5);
      expect(await d.incr!('f', 0.5)).toBe(0.5);
      expect(await d.incr!('f', 1.25)).toBe(1.75);
      expect(await d.incr!('f', 2)).toBe(3.75); // integer step on a float value
      await expect(d.incr!('n', Infinity)).rejects.toThrow('finite');
      await d.set('s', 'text');
      await expect(d.incr!('s')).rejects.toThrow('not an integer');
    }
  });

  test('incr is undefined for a RedisCommands implementation without incrby', () => {
    const s = new FakeRedisServer();
    const d = new RedisDriver({
      client: markNormalized({
        get: async (k) => s.get(k),
        set: async (k, v, ttl) => s.set(k, v, ttl),
        del: async (keys) => { s.del(keys); },
        async *scan() { yield []; },
      } as RedisCommands),
    });
    expect(d.incr).toBeUndefined();
  });

  test('custom RedisCommands implementations are used as-is', async () => {
    const s = new FakeRedisServer();
    const custom: RedisCommands = {
      get: async (k) => s.get(k),
      set: async (k, v, ttl) => s.set(k, v, ttl),
      del: async (keys) => { s.del(keys); },
      async *scan(pattern) { yield [...s.data.keys()].filter((k) => globToRegExp(pattern).test(k)); },
    };
    const d = new RedisDriver({ client: custom });
    await d.set('x', [1]);
    expect(await d.entries('x')).toEqual([['x', [1]]]);
  });
});

describe('redisSessionStore', () => {
  test('stores sessions with prefix + ttl', async () => {
    const c = fakeIoredis();
    const store = redisSessionStore({ client: c, namespace: 'b:', ttl: 20 });
    await store.set('telegram:1', { step: 2 });
    expect(c.server.data.get('b:session:telegram:1')!.v).toBe('{"step":2}');
    expect(await store.get('telegram:1')).toEqual({ step: 2 });
    await new Promise((r) => setTimeout(r, 40));
    expect(await store.get('telegram:1')).toBeNull();
  });

  test('works as createBot session store', async () => {
    const c = fakeUpstash();
    function C() {
      const [s, set] = useSession<{ seen?: boolean }>();
      if (!s.seen) set({ seen: true });
      return <Message text="ok" />;
    }
    const bot = createBot({ component: C, adapter: new MockAdapter(), token: 't', session: { store: redisSessionStore({ client: c }) } });
    await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
    const [key] = [...c.server.data.keys()];
    expect(key).toStartWith('session:');
    expect(JSON.parse(c.server.data.get(key)!.v)).toEqual({ seen: true });
    await bot.stop();
  });
});

describe('storagePlugin + RedisDriver (integration)', () => {
  function Visits() {
    const { messageId } = useBot();
    const [visits, setVisits] = useStorage<{ n: number; last?: string }>('visits', { n: 0 });
    if (visits.last !== messageId) setVisits({ n: visits.n + 1, last: messageId });
    return <Message text={`visits ${visits.n}`} />;
  }

  for (const [name, make] of [
    ['ioredis', fakeIoredis],
    ['node-redis', fakeNodeRedis],
    ['bun', fakeBunRedis],
    ['upstash', fakeUpstash],
  ] as const) {
    test(`${name}: writes are durable before bot.fetch() resolves`, async () => {
      const client = make();
      const driver = new RedisDriver({ client, namespace: 'app:' });
      const bot = createBot({ component: Visits, adapter: new MockAdapter(), token: 't', plugins: [storagePlugin({ driver })] });
      await bot.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) }));
      const keys = [...client.server.data.keys()];
      expect(keys.length).toBe(1);
      expect(keys[0]).toStartWith('app:mock:');
      expect(keys[0]).toEndWith(':visits');
      expect(JSON.parse(client.server.data.get(keys[0])!.v).n).toBe(1);
      await bot.stop();
    });
  }
});

describe('redisPlugin', () => {
  test('provides the client via useRedis(); leaves it open on stop by default', async () => {
    const client = fakeIoredis();
    const bot = createBot({
      component: () => <Message text="x" />,
      adapter: new MockAdapter(),
      token: 't',
      plugins: [redisPlugin({ client }), storagePlugin({ driver: new RedisDriver({ client }) })],
    });
    await bot.start();
    await bot.stop();
    expect(client.quitted).toBe(0); // the client was given, so nobody closes it
  });

  test('closeOnStop + closeClient close a shared client exactly once', async () => {
    const client = fakeIoredis();
    await client.set('greeting', 'hi from redis');
    function App() {
      const redis = useRedis<ReturnType<typeof fakeIoredis>>();
      return <Message text={`has=${typeof redis.get}`} />;
    }
    const adapter = new MockAdapter();
    const bot = createBot({
      component: App,
      adapter,
      token: 't',
      plugins: [redisPlugin({ client, closeOnStop: true }), storagePlugin({ driver: new RedisDriver({ client, closeClient: true }) })],
    });
    await bot.start();
    await adapter.simulateMessage('1', '1', 'x');
    expect(JSON.stringify(adapter.getLastSent())).toContain('has=function');
    await bot.stop();
    expect(client.quitted).toBe(1); // shared client closed exactly once
  });

  test('closeOnStop: true closes a node-redis client', async () => {
    const client = fakeNodeRedis();
    const bot = createBot({ component: () => <Message text="x" />, adapter: new MockAdapter(), token: 't', plugins: [redisPlugin({ client, closeOnStop: true })] });
    await bot.start();
    await bot.stop();
    expect(client.closed).toBe(1);
  });
});
