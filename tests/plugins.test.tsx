import { describe, test, expect, afterEach } from 'bun:test';
import React from 'react';
import { createBot, useBot, type BotContext, type TeactPlugin } from '../packages/core/src';
import { MockAdapter } from '../packages/testing/src';
import { MemoryDriver, MemoryAsyncDriver } from '../packages/storage/src';
import {
  rateLimit,
  logger,
  maintenance,
  chatFilter,
  ignoreOld,
  errorReporter,
  analytics,
  useTrack,
  featureFlags,
  useFlag,
  rolloutBucket,
  type LogEntry,
} from '../packages/plugins/src';

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const App = () => React.createElement('tg-message', { text: 'rendered' });

type Bot = ReturnType<typeof createBot>;
let running: Bot[] = [];
afterEach(async () => {
  for (const b of running) await b.stop();
  running = [];
});

async function setup(plugins: TeactPlugin[], component: React.FC = App, extra: Record<string, unknown> = {}) {
  const adapter = new MockAdapter();
  const bot = createBot({ component, adapter, token: 'test', plugins, ...extra });
  await bot.start();
  running.push(bot);
  return { adapter, bot };
}

/** Dispatch a hand-built context (custom raw / chat ids) through the adapter's listeners. */
function emit(adapter: MockAdapter, ctx: Partial<BotContext> & { chatId: string; userId: string }) {
  const full: BotContext = {
    platform: 'mock',
    user: { id: ctx.userId, platform: 'mock' },
    raw: {},
    ...ctx,
  };
  return (adapter as any).emit(full.callbackData != null ? 'callback_query' : 'message', full) as Promise<void>;
}

const texts = (a: MockAdapter) => a.sent.map((s) => s.output.props.text as string);

// ---------------------------------------------------------------------------

describe('rateLimit', () => {
  test('blocks over the limit and notifies once per window', async () => {
    const { adapter } = await setup([rateLimit({ window: 150, limit: 2, onLimited: 'slow down' })]);
    for (let i = 0; i < 5; i++) await adapter.simulateMessage('1', '1', `m${i}`);
    expect(texts(adapter)).toEqual(['rendered', 'rendered', 'slow down']);
  });

  test('window resets (sliding)', async () => {
    const { adapter } = await setup([rateLimit({ window: 80, limit: 1, onLimited: 'slow down' })]);
    await adapter.simulateMessage('1', '1', 'a');
    await adapter.simulateMessage('1', '1', 'b');
    await wait(100);
    await adapter.simulateMessage('1', '1', 'c');
    await adapter.simulateMessage('1', '1', 'd');
    expect(texts(adapter)).toEqual(['rendered', 'slow down', 'rendered', 'slow down']);
  });

  test('fixed window strategy resets on the next bucket', async () => {
    const { adapter } = await setup([rateLimit({ window: 200, limit: 1, strategy: 'fixed' })]);
    // Start right after a bucket boundary so 'a' and 'b' are in the same aligned window.
    await wait(200 - (Date.now() % 200) + 5);
    await adapter.simulateMessage('1', '1', 'a');
    await adapter.simulateMessage('1', '1', 'b');
    expect(texts(adapter)).toEqual(['rendered']);
    await wait(220);
    await adapter.simulateMessage('1', '1', 'c');
    expect(texts(adapter)).toEqual(['rendered', 'rendered']);
  });

  test('keys per user by default, per chat with key: "chat"', async () => {
    const perUser = await setup([rateLimit({ window: 1000, limit: 1 })]);
    await perUser.adapter.simulateMessage('1', '1', 'a');
    await perUser.adapter.simulateMessage('2', '2', 'a');
    expect(perUser.adapter.sent.length).toBe(2);

    const perChat = await setup([rateLimit({ window: 1000, limit: 1, key: 'chat' })]);
    await perChat.adapter.simulateMessage('-100', '1', 'a');
    await perChat.adapter.simulateMessage('-100', '2', 'b');
    expect(perChat.adapter.sent.length).toBe(1);
  });

  test('custom key returning null skips limiting', async () => {
    const { adapter } = await setup([rateLimit({ window: 1000, limit: 1, key: (c) => (c.userId === 'admin' ? null : c.userId) })]);
    for (let i = 0; i < 3; i++) await adapter.simulateMessage('1', 'admin', 'x');
    expect(adapter.sent.length).toBe(3);
  });

  test('onLimited function receives ctx and reply', async () => {
    const seen: string[] = [];
    const { adapter } = await setup([
      rateLimit({ window: 1000, limit: 1, onLimited: async (ctx, reply) => { seen.push(ctx.userId); await reply('custom'); } }),
    ]);
    await adapter.simulateMessage('1', '1', 'a');
    await adapter.simulateMessage('1', '1', 'b');
    expect(seen).toEqual(['1']);
    expect(texts(adapter)).toEqual(['rendered', 'custom']);
  });

  test('shared sync storage driver: limits carry across bot instances', async () => {
    const storage = new MemoryDriver();
    const a = await setup([rateLimit({ window: 5000, limit: 2, storage })]);
    await a.adapter.simulateMessage('1', '1', 'a');
    await a.adapter.simulateMessage('1', '1', 'b');
    expect(a.adapter.sent.length).toBe(2);
    const b = await setup([rateLimit({ window: 5000, limit: 2, storage })]);
    await b.adapter.simulateMessage('1', '1', 'c');
    expect(b.adapter.sent.length).toBe(0);
  });

  test('shared async storage driver (fixed window)', async () => {
    const storage = new MemoryAsyncDriver();
    const a = await setup([rateLimit({ window: 5000, limit: 1, storage, strategy: 'fixed' })]);
    await a.adapter.simulateMessage('1', '1', 'a');
    const b = await setup([rateLimit({ window: 5000, limit: 1, storage, strategy: 'fixed' })]);
    await b.adapter.simulateMessage('1', '1', 'b');
    expect(a.adapter.sent.length + b.adapter.sent.length).toBe(1);
    expect((await storage.keys('teact:ratelimit:')).length).toBe(1);
  });

  test('validates options', () => {
    expect(() => rateLimit({ window: 0 })).toThrow();
    expect(() => rateLimit({ limit: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('logger', () => {
  test('emits JSON entries to a custom sink', async () => {
    const lines: string[] = [];
    const { adapter } = await setup([logger({ format: 'json', logger: (_e, line) => lines.push(line) })]);
    await adapter.simulateMessage('1', '1', 'hello');
    await adapter.simulateCallback('1', '1', 'btn');
    expect(lines.length).toBe(2);
    const [msg, cb] = lines.map((l) => JSON.parse(l) as LogEntry);
    expect(msg).toMatchObject({ level: 'info', event: 'update', type: 'message', chatId: '1', userId: '1', text: 'hello', chatType: 'private' });
    expect(typeof msg.durationMs).toBe('number');
    expect(cb).toMatchObject({ type: 'callback_query', callbackData: 'btn' });
  });

  test('truncates text, redacts fields, respects level', async () => {
    const entries: LogEntry[] = [];
    const { adapter } = await setup([
      logger({ level: 'debug', maxTextLength: 5, redact: ['userId'], logger: (e) => entries.push(e) }),
    ]);
    await adapter.simulateMessage('1', '1', '/start something long');
    expect(entries.map((e) => e.event)).toEqual(['update.start', 'update']);
    expect(entries[1].text).toBe('/star…');
    expect(entries[1].type).toBe('command');
    expect(entries[1].userId).toBe('[redacted]');

    const warnOnly: LogEntry[] = [];
    const b = await setup([logger({ level: 'warn', logger: (e) => warnOnly.push(e) })]);
    await b.adapter.simulateMessage('1', '1', 'x');
    expect(warnOnly.length).toBe(0);
  });

  test('marks updates blocked by later plugins and logs errors', async () => {
    const entries: LogEntry[] = [];
    const sink = { info: (l: string) => entries.push(JSON.parse(l)), error: (l: string) => entries.push(JSON.parse(l)) };
    const { adapter } = await setup(
      [logger({ format: 'json', logger: sink }), maintenance({ enabled: true, message: null })],
    );
    await adapter.simulateMessage('1', '1', 'x');
    expect(entries[0].halted).toBe(true);

    const errs: LogEntry[] = [];
    const b = await setup([logger({ logger: (e) => errs.push(e) })], App, {
      middleware: [async () => { throw new Error('boom'); }],
    });
    const origError = console.error;
    console.error = () => {};
    try { await b.adapter.simulateMessage('1', '1', 'x'); } finally { console.error = origError; }
    expect(errs[0]).toMatchObject({ level: 'error', event: 'update.error', error: { message: 'boom' } });
  });

  test('pretty format writes one line via console-like logger', async () => {
    const lines: string[] = [];
    const { adapter } = await setup([logger({ logger: { info: (l) => lines.push(l) } })]);
    await adapter.simulateMessage('1', '1', 'hi');
    expect(lines[0]).toContain('chat 1');
    expect(lines[0]).toContain('"hi"');
  });
});

// ---------------------------------------------------------------------------

describe('maintenance', () => {
  test('blocks everyone except the allow-list and replies', async () => {
    const { adapter } = await setup([maintenance({ enabled: true, allow: [42], message: 'down' })]);
    await adapter.simulateMessage('1', '1', 'x');
    await adapter.simulateMessage('42', '42', 'x');
    expect(adapter.sent.map((s) => [s.chatId, s.output.props.text])).toEqual([[1, 'down'], [42, 'rendered']]);
  });

  test('dynamic isEnabled toggles at runtime', async () => {
    let on = false;
    const { adapter } = await setup([maintenance({ isEnabled: async () => on })]);
    await adapter.simulateMessage('1', '1', 'x');
    on = true;
    await adapter.simulateMessage('1', '1', 'y');
    expect(texts(adapter)[0]).toBe('rendered');
    expect(texts(adapter)[1]).toContain('maintenance');
  });

  test('enabled: false passes through; message: null is silent', async () => {
    const a = await setup([maintenance({ enabled: false })]);
    await a.adapter.simulateMessage('1', '1', 'x');
    expect(texts(a.adapter)).toEqual(['rendered']);
    const b = await setup([maintenance({ message: null })]);
    await b.adapter.simulateMessage('1', '1', 'x');
    expect(b.adapter.sent.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('chatFilter', () => {
  test('filters by chat type from raw update', async () => {
    const { adapter } = await setup([chatFilter({ allow: ['private'], onBlocked: 'DM me' })]);
    await emit(adapter, { chatId: '-100', userId: '1', text: 'x', raw: { chat: { type: 'supergroup' } } });
    expect(texts(adapter)).toEqual(['DM me']);
    await emit(adapter, { chatId: '5', userId: '5', text: 'x', raw: { chat: { type: 'private' } } });
    expect(texts(adapter)).toEqual(['DM me', 'rendered']);
  });

  test('reads nested raw message chat type and falls back to chatId === userId', async () => {
    const { adapter } = await setup([chatFilter({ allow: ['group'] })]);
    await emit(adapter, { chatId: '-1', userId: '1', text: 'x', raw: { update: { message: { chat: { type: 'group' } } } } });
    expect(adapter.sent.length).toBe(1);
    await adapter.simulateMessage('7', '7', 'x'); // no raw info → private
    expect(adapter.sent.length).toBe(1);
    await emit(adapter, { chatId: '-9', userId: '1', text: 'x' }); // unknown type → blocked
    expect(adapter.sent.length).toBe(1);
  });

  test('user allow-list and deny-list (deny wins)', async () => {
    const { adapter } = await setup([chatFilter({ users: [1, '2'], block: ['2', -300] })]);
    await adapter.simulateMessage('1', '1', 'x');
    await adapter.simulateMessage('2', '2', 'x');
    await adapter.simulateMessage('3', '3', 'x');
    await adapter.simulateMessage('-300', '1', 'x');
    expect(adapter.sent.map((s) => s.chatId)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------

describe('ignoreOld', () => {
  test('drops messages older than maxAge, keeps fresh ones and callbacks', async () => {
    const ignored: number[] = [];
    const { adapter } = await setup([ignoreOld({ maxAge: 60, onIgnored: (_c, age) => ignored.push(age) })]);
    const now = Math.floor(Date.now() / 1000);
    await emit(adapter, { chatId: '1', userId: '1', text: 'old', raw: { msg: { date: now - 3600 } } });
    expect(adapter.sent.length).toBe(0);
    expect(ignored[0]).toBeGreaterThan(3500);
    await emit(adapter, { chatId: '1', userId: '1', text: 'new', raw: { message: { date: now - 5 } } });
    expect(adapter.sent.length).toBe(1);
    await emit(adapter, { chatId: '1', userId: '1', callbackData: 'x', raw: { callbackQuery: { message: { date: now - 99999 } } } });
    expect(ignored.length).toBe(1);
    await adapter.simulateMessage('1', '1', 'no date'); // no date → passes
    expect(adapter.sent.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------

describe('errorReporter', () => {
  test('catches middleware errors, reports with context, notifies the user', async () => {
    const reports: Array<{ err: unknown; info: any }> = [];
    const { adapter } = await setup(
      [errorReporter({ report: (err, _ctx, info) => { reports.push({ err, info }); }, notifyUser: 'oops', include: ['user', 'text'] })],
      App,
      { middleware: [async (c: BotContext) => { if (c.text === 'fail') throw new Error('mw failed'); }] },
    );
    await adapter.simulateMessage('1', '1', 'fail');
    expect(reports.length).toBe(1);
    expect((reports[0].err as Error).message).toBe('mw failed');
    expect(reports[0].info).toMatchObject({ source: 'middleware', context: { type: 'message', user: { id: '1' }, text: 'fail' } });
    expect(reports[0].info.context.chat).toBeUndefined();
    expect(texts(adapter)).toEqual(['oops']);
    await adapter.simulateMessage('1', '1', 'fine');
    expect(texts(adapter)).toEqual(['oops', 'rendered']);
  });

  test('catches render errors, shows notifyUser, and the chat recovers', async () => {
    const reports: any[] = [];
    function Flaky() {
      const { text } = useBot();
      if (text === 'crash') throw new Error('render failed');
      return React.createElement('tg-message', { text: `ok ${text}` });
    }
    const { adapter } = await setup(
      [errorReporter({ report: (err, ctx, info) => { reports.push({ err, ctx, info }); }, notifyUser: 'render oops' })],
      Flaky,
    );
    const origError = console.error;
    console.error = () => {};
    try {
      await adapter.simulateMessage('1', '1', 'crash');
      await wait();
    } finally { console.error = origError; }
    expect(reports.length).toBe(1);
    expect(reports[0].err.message).toBe('render failed');
    expect(reports[0].info.source).toBe('render');
    expect(reports[0].ctx.chatId).toBe('1');
    expect(texts(adapter)).toEqual(['render oops']);
    await adapter.simulateMessage('1', '1', 'again');
    expect(texts(adapter).at(-1)).toBe('ok again');
  });

  test('without notifyUser, render errors are reported and Teact default fallback is used', async () => {
    const reports: unknown[] = [];
    const Crash = () => { throw new Error('kaput'); };
    const { adapter } = await setup([errorReporter({ report: (e) => { reports.push(e); } })], Crash);
    const origError = console.error;
    console.error = () => {};
    try {
      await adapter.simulateMessage('1', '1', 'x');
      await wait();
    } finally { console.error = origError; }
    expect(reports.length).toBe(1);
    expect(texts(adapter)[0]).toContain('Something went wrong');
    expect(texts(adapter)[0]).not.toContain('kaput');
  });

  test('a throwing report() never breaks the update', async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { adapter } = await setup(
        [errorReporter({ report: () => { throw new Error('sentry down'); } })],
        App,
        { middleware: [async () => { throw new Error('x'); }] },
      );
      await adapter.simulateMessage('1', '1', 'x');
    } finally { console.error = origError; }
  });
});

// ---------------------------------------------------------------------------

describe('analytics', () => {
  test('counts updates, commands and unique users; forwards events', async () => {
    const events: string[] = [];
    const stats = analytics({ track: (e) => { events.push(`${e.name}:${e.properties?.type}`); } });
    const { adapter } = await setup([stats]);
    await adapter.simulateMessage('1', '1', '/start');
    await adapter.simulateMessage('1', '1', '/start@bot');
    await adapter.simulateMessage('2', '2', '/help');
    await adapter.simulateCallback('2', '2', 'x');
    const s = await stats.getStats();
    expect(s.updates).toBe(4);
    expect(s.updatesOnDay).toBe(4);
    expect(s.uniqueUsers).toBe(2);
    expect(s.commands).toEqual({ start: 2, help: 1 });
    expect(events).toEqual(['update:command', 'update:command', 'update:command', 'update:callback_query']);
    expect((await stats.getStats('2000-01-01')).uniqueUsers).toBe(0);
  });

  test('useTrack records custom events bound to the current user', async () => {
    const tracked: any[] = [];
    const stats = analytics({ track: (e) => { if (e.name !== 'update') tracked.push(e); } });
    function Tracker() {
      const track = useTrack();
      const { text } = useBot();
      React.useEffect(() => { void track('viewed', { text }); }, [track, text]);
      return React.createElement('tg-message', { text: 'tracked' });
    }
    const { adapter } = await setup([stats], Tracker);
    await adapter.simulateMessage('9', '9', 'hello');
    await wait();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({ name: 'viewed', userId: '9', chatId: '9', properties: { text: 'hello' } });
    expect((await stats.getStats()).events).toEqual({ viewed: 1 });
  });

  test('shared storage aggregates across instances', async () => {
    const storage = new MemoryAsyncDriver();
    const a = analytics({ storage });
    const b = analytics({ storage });
    const ba = await setup([a]);
    await ba.adapter.simulateMessage('1', '1', 'x');
    const bb = await setup([b]);
    await bb.adapter.simulateMessage('2', '2', 'x');
    await bb.adapter.simulateMessage('1', '1', 'x');
    const s = await a.getStats();
    expect(s.updates).toBe(3);
    expect(s.uniqueUsers).toBe(2);
  });

  test('useTrack without the plugin throws a helpful error', async () => {
    const reports: unknown[] = [];
    const Bad = () => { useTrack(); return null; };
    const origError = console.error;
    console.error = () => {};
    try {
      const { adapter } = await setup([errorReporter({ report: (e) => { reports.push(e); }, notifyUser: 'x' })], Bad);
      await adapter.simulateMessage('1', '1', 'x');
      await wait();
    } finally { console.error = origError; }
    expect(String((reports[0] as Error).message)).toContain('analytics()');
  });
});

// ---------------------------------------------------------------------------

describe('featureFlags', () => {
  const FlagApp = () => {
    const a = useFlag('static');
    const b = useFlag('beta');
    const c = useFlag('remote');
    const d = useFlag('missing');
    return React.createElement('tg-message', { text: [a, b, c, d].map(Number).join('') });
  };

  test('useFlag reads constant, sync and async predicates', async () => {
    const { adapter } = await setup([
      featureFlags({
        flags: {
          static: true,
          beta: (ctx) => ctx.userId === '7',
          remote: async (ctx) => { await wait(1); return ctx.chatId === '7'; },
        },
      }),
    ], FlagApp);
    await adapter.simulateMessage('7', '7', 'x');
    await adapter.simulateMessage('8', '8', 'x');
    expect(texts(adapter)).toEqual(['1110', '1000']);
  });

  test('rollout percentage is deterministic per user', async () => {
    const ff = featureFlags({ flags: {}, rollout: { half: 50, none: 0, all: 100 } });
    const ctxFor = (id: string): BotContext => ({ chatId: id, userId: id, user: { id, platform: 'mock' }, platform: 'mock', raw: {} });
    let enabled = 0;
    for (let i = 0; i < 400; i++) {
      const c = ctxFor(String(i));
      const on = await ff.isEnabled('half', c);
      expect(on).toBe(rolloutBucket(`half:${i}`) < 50);
      expect(await ff.isEnabled('half', c)).toBe(on);
      if (on) enabled++;
      expect(await ff.isEnabled('none', c)).toBe(false);
      expect(await ff.isEnabled('all', c)).toBe(true);
    }
    expect(enabled).toBeGreaterThan(140);
    expect(enabled).toBeLessThan(260);
  });

  test('a throwing predicate counts as off', async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const ff = featureFlags({ flags: { bad: () => { throw new Error('x'); } } });
      const c: BotContext = { chatId: '1', userId: '1', user: { id: '1', platform: 'mock' }, platform: 'mock', raw: {} };
      expect(await ff.isEnabled('bad', c)).toBe(false);
    } finally { console.error = origError; }
  });
});

// ---------------------------------------------------------------------------

describe('plugin shape', () => {
  test('all factories return named teact-* plugins', () => {
    const plugins = [
      rateLimit(), logger(), maintenance(), chatFilter(), ignoreOld(),
      errorReporter({ report: () => {} }), analytics(), featureFlags({ flags: {} }),
    ];
    for (const p of plugins) {
      expect(p.name).toMatch(/^teact-/);
      expect(typeof p.middleware).toBe('function');
    }
    expect(new Set(plugins.map((p) => p.name)).size).toBe(plugins.length);
  });
});

describe('release-review regressions', () => {
  const ctxOf = (userId: string, text = 'x'): BotContext => ({
    chatId: userId, userId, platform: 'mock', text, raw: {}, user: { id: userId, platform: 'mock' },
  });
  /** Run a plugin's middleware like the bot would; true when the update got through. */
  const passes = async (p: TeactPlugin, ctx: BotContext) => {
    let reached = false;
    await p.middleware!(ctx, async () => { reached = true; });
    return reached;
  };

  test('fixed-window rateLimit holds across instances sharing a driver with incr()', async () => {
    const shared = new MemoryAsyncDriver();
    const a = rateLimit({ window: 60_000, limit: 3, strategy: 'fixed', storage: shared });
    const b = rateLimit({ window: 60_000, limit: 3, strategy: 'fixed', storage: shared });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => passes(i % 2 ? a : b, ctxOf('42'))),
    );
    expect(results.filter(Boolean).length).toBe(3);
  });

  test('analytics counts are exact across instances and ignore junk command names', async () => {
    const shared = new MemoryAsyncDriver();
    const a = analytics({ storage: shared });
    const b = analytics({ storage: shared });
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => passes(i % 2 ? a : b, ctxOf(String(i % 3), '/start'))),
      passes(a, ctxOf('9', '/constructor')),
      passes(a, ctxOf('9', '/not-a-command!')),
    ]);
    const s = await a.getStats();
    expect(s.updates).toBe(12);
    expect(s.uniqueUsers).toBe(4);
    expect(s.commands.start).toBe(10);
    expect(s.commands['constructor' as string]).toBe(1); // counted as a plain name, not Object's constructor
    expect(Object.keys(s.commands).sort()).toEqual(['constructor', 'start']);
  });

  test("errorReporter include: ['raw'] never forwards the grammY context (bot token)", async () => {
    const reports: any[] = [];
    const p = errorReporter({ report: (_e, _c, info) => { reports.push(info); }, include: ['raw'] });
    const ctx = ctxOf('1');
    ctx.raw = { api: { token: '123:SECRET' }, update: { update_id: 7, message: { text: 'x' } } };
    await p.middleware!(ctx, async () => { throw new Error('boom'); });
    expect(JSON.stringify(reports)).not.toContain('SECRET');
    expect(JSON.stringify(reports)).toContain('update_id');
  });
});
