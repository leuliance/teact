import { describe, test, expect } from 'bun:test';
import React, { Suspense, use, useEffect, useState } from 'react';
import {
  createRouter, useNavigate, useParams, useRoute, redirect, rateLimitPlugin, loggerPlugin, kvSessionStore,
  ErrorBoundary, type Middleware, type TeactPlugin,
} from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { serializeOutput } from '../packages/telegram/src';
import { createTestBot } from '../packages/testing/src';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil timed out');
    await sleep(10);
  }
}

/** Capture console.warn / console.error output while running fn. */
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[]; errors: string[] }> {
  const warns: string[] = [], errors: string[] = [];
  const ow = console.warn, oe = console.error;
  console.warn = (...a: any[]) => { warns.push(a.map(String).join(' ')); };
  console.error = (...a: any[]) => { errors.push(a.map(String).join(' ')); };
  try { return { result: await fn(), warns, errors }; }
  finally { console.warn = ow; console.error = oe; }
}

function sharedStore() {
  const data = new Map<string, string>();
  return kvSessionStore({ get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } });
}

function ItemPage() {
  const { id } = useParams();
  return <Message text={`item=${JSON.stringify(id)}`} />;
}

function linkMenu(params: Record<string, string>) {
  return () => (
    <Message text="menu">
      <InlineKeyboard><Button text="Open" route="/item/:id" params={params} /></InlineKeyboard>
    </Message>
  );
}

// ---------------------------------------------------------------------------------------
describe('route params round-trip through <Button route params>', () => {
  for (const value of ['hello world', '🔥emoji', 'a%20b', 'q?x=1#frag', 'ünïcödé', '../admin']) {
    test(`/item/:id receives exactly ${JSON.stringify(value)}`, async () => {
      const router = createRouter({ '/': linkMenu({ id: value }), '/item/:id': ItemPage });
      const t = await createTestBot({ router });
      await t.send('/start');
      await t.click('Open');
      expect(t.lastMessage?.text).toBe(`item=${JSON.stringify(value)}`);
      await t.stop();
    });
  }

  test('a param value containing "/" still reaches /item/:id intact', async () => {
    const router = createRouter({ '/': linkMenu({ id: 'a/b' }), '/item/:id': ItemPage });
    const t = await createTestBot({ router });
    await t.send('/start');
    await t.click('Open');
    expect(t.lastMessage?.text).toBe('item="a/b"');
    await t.stop();
  });

  test('a param containing "/" cannot hijack a different, deeper route', async () => {
    // Attacker-controlled value (e.g. a username) rendered into a link.
    const router = createRouter({
      '/': linkMenu({ id: '1/delete' }),
      '/item/:id': ItemPage,
      '/item/:id/delete': () => <Message text="DELETED" />,
    });
    const t = await createTestBot({ router });
    await t.send('/start');
    await t.click('Open');
    expect(t.lastMessage?.text).not.toBe('DELETED');
    await t.stop();
  });

  test('a long param (>64 bytes callback data) still routes via aliasing', async () => {
    const long = 'x'.repeat(200);
    const router = createRouter({ '/': linkMenu({ id: long }), '/item/:id': ItemPage });
    const t = await createTestBot({ router });
    await t.send('/start');
    expect(new TextEncoder().encode(t.lastMessage!.buttons[0][0].data!).length).toBeLessThanOrEqual(64);
    await t.click('Open');
    expect(t.lastMessage?.text).toBe(`item=${JSON.stringify(long)}`);
    await t.stop();
  });
});

describe('route matching', () => {
  test('trailing slashes are normalized', async () => {
    const router = createRouter({ '/': () => <Message text="home" />, '/a': () => <Message text="A" /> });
    const t = await createTestBot({ router, commands: { go: { description: 'g', route: '/a//' } } });
    await t.send('/go');
    expect(t.lastMessage?.text).toBe('A');
    await t.stop();
  });

  test('static route beats param route regardless of declaration order', async () => {
    const router = createRouter({
      '/a/:id': () => { const { id } = useParams(); return <Message text={`id:${id}`} />; },
      '/a/new': () => <Message text="NEW" />,
      '/': () => <Message text="home" />,
    });
    const t = await createTestBot({ router, commands: { n: { description: 'n', route: '/a/new' }, x: { description: 'x', route: '/a/7' } } });
    await t.send('/n');
    expect(t.lastMessage?.text).toBe('NEW');
    await t.send('/x');
    expect(t.lastMessage?.text).toBe('id:7');
    await t.stop();
  });

  test('unknown route renders the custom notFound', async () => {
    const router = createRouter({ '/': () => <Message text="home" /> }, { notFound: () => <Message text="404!" /> });
    const t = await createTestBot({ router, commands: { x: { description: 'x', route: '/nope' } } });
    await t.send('/x');
    expect(t.lastMessage?.text).toBe('404!');
    await t.stop();
  });

  test('useRoute inside notFound reports the requested path', async () => {
    const router = createRouter({ '/': () => <Message text="home" /> }, {
      notFound: () => { const r = useRoute(); return <Message text={`missing ${r.path}`} />; },
    });
    const t = await createTestBot({ router, commands: { x: { description: 'x', route: '/nope' } } });
    await t.send('/x');
    expect(t.lastMessage?.text).toBe('missing /nope');
    await t.stop();
  });
});

describe('guards', () => {
  test('a throwing guard fails closed (notFound, never the protected page)', async () => {
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/admin': { component: () => <Message text="SECRET" />, beforeLoad: () => { throw new Error('db down'); } },
    }, { notFound: () => <Message text="404" /> });
    const { errors } = await captureConsole(async () => {
      const t = await createTestBot({ router, commands: { admin: { description: 'a', route: '/admin' } } });
      await t.send('/admin');
      expect(t.lastMessage?.text).toBe('404');
      await t.stop();
    });
    expect(errors.some((e) => e.includes('beforeLoad'))).toBe(true);
  });

  test('a redirect loop ends on notFound with a warning', async () => {
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/a': { component: () => <Message text="A" />, beforeLoad: () => redirect('/b') },
      '/b': { component: () => <Message text="B" />, beforeLoad: () => ({ redirect: '/a' }) },
    }, { notFound: () => <Message text="404" /> });
    const { warns } = await captureConsole(async () => {
      const t = await createTestBot({ router, commands: { a: { description: 'a', route: '/a' } } });
      await t.send('/a');
      expect(t.lastMessage?.text).toBe('404');
      await t.stop();
    });
    expect(warns.some((w) => w.includes('redirect loop'))).toBe(true);
  });

  test('a guard returning { redirect: <own path> } renders the page (same as string form)', async () => {
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/a': { component: () => <Message text="A" />, beforeLoad: ({ path }) => ({ redirect: path }) },
    }, { notFound: () => <Message text="404" /> });
    const { result } = await captureConsole(async () => {
      const t = await createTestBot({ router, commands: { a: { description: 'a', route: '/a' } } });
      await t.send('/a');
      const text = t.lastMessage?.text;
      await t.stop();
      return text;
    });
    expect(result).toBe('A');
  });

  test('guard reply() buttons navigate to their route', async () => {
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/login': () => <Message text="login page" />,
      '/admin': {
        component: () => <Message text="SECRET" />,
        beforeLoad: ({ session, reply }) => session.auth ? undefined : reply('Please log in', { buttons: [[{ text: 'Login', route: '/login' }]] }),
      },
    });
    const t = await createTestBot({ router, commands: { admin: { description: 'a', route: '/admin' } } });
    await t.send('/admin');
    expect(t.lastMessage?.text).toBe('Please log in');
    await t.click('Login');
    expect(t.lastMessage?.text).toBe('login page');
    await t.stop();
  });

  test('forged __route: callback to a guarded page still runs the guard', async () => {
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/admin': { component: () => <Message text="SECRET" />, beforeLoad: () => '/' },
    });
    const t = await createTestBot({ router });
    await t.send('/start');
    await t.adapter.simulateCallback('1', '1', '__route:/admin');
    expect(t.messages.some((m) => m.text === 'SECRET')).toBe(false);
    await t.stop();
  });
});

describe('navigate', () => {
  test('navigate() in useEffect on mount does not loop and lands on the target', async () => {
    let mounts = 0;
    function A() {
      const navigate = useNavigate();
      useEffect(() => { mounts++; navigate('/b'); }, []);
      return <Message text="A" />;
    }
    const router = createRouter({ '/': A, '/b': () => <Message text="B" /> });
    const t = await createTestBot({ router });
    await t.send('/start');
    await sleep(30);
    expect(t.lastMessage?.text).toBe('B');
    expect(mounts).toBe(1);
    expect(t.adapter.sent.length).toBeLessThanOrEqual(1);
    await t.stop();
  });

  test('navigate() to the same path is harmless', async () => {
    function A() {
      const navigate = useNavigate();
      const [n, setN] = useState(0);
      return <Message text={`A${n}`}><InlineKeyboard><Button text="same" onClick={() => { setN(n + 1); navigate('/'); }} /></InlineKeyboard></Message>;
    }
    const router = createRouter({ '/': A });
    const t = await createTestBot({ router });
    await t.send('/start');
    await t.click('same');
    await t.click('same');
    expect(t.lastMessage?.text).toBe('A2');
    expect(t.adapter.sent.length).toBe(1);
    await t.stop();
  });

  function modes() {
    function Page({ name }: { name: string }) {
      const navigate = useNavigate();
      return (
        <Message text={name}>
          <InlineKeyboard>
            <Button text="push" onClick={() => navigate('/p', { mode: 'push' })} />
            <Button text="stack" onClick={() => navigate('/s', { mode: 'stack' })} />
            <Button text="dismiss" onClick={() => navigate('/d', { mode: 'dismiss' })} />
            <Button text="replace" onClick={() => navigate('/r')} />
          </InlineKeyboard>
        </Message>
      );
    }
    return createRouter({
      '/': () => <Page name="home" />, '/p': () => <Page name="P" />, '/s': () => <Page name="S" />,
      '/d': () => <Page name="D" />, '/r': () => <Page name="R" />,
    });
  }

  test('push keeps the old message and sends a new one; replace then edits the new one', async () => {
    const t = await createTestBot({ router: modes() });
    await t.send('/start');
    const first = t.lastMessage!.id;
    await t.click('push');
    expect(t.messages.length).toBe(2);
    expect(t.messages[0].text).toBe('home');
    expect(t.lastMessage?.text).toBe('P');
    const second = t.lastMessage!.id;
    expect(second).not.toBe(first);
    await t.adapter.simulateCallback('1', '1', t.lastMessage!.buttons.flat().find((b) => b.text === 'replace')!.data!, String(second), { callbackLabel: 'replace' });
    expect(t.messages.length).toBe(2);
    expect(t.messages.find((m) => m.id === second)?.text).toBe('R');
    await t.stop();
  });

  test('stack clears the old buttons and sends a new message', async () => {
    const t = await createTestBot({ router: modes() });
    await t.send('/start');
    const first = t.lastMessage!.id;
    await t.click('stack');
    expect(t.adapter.cleared.map((c) => c.messageId)).toEqual([first]);
    expect(t.lastMessage?.text).toBe('S');
    expect(t.messages.length).toBe(2);
    await t.stop();
  });

  test('dismiss clears buttons and sends nothing new', async () => {
    const t = await createTestBot({ router: modes() });
    await t.send('/start');
    const first = t.lastMessage!.id;
    await t.click('dismiss');
    expect(t.adapter.cleared.map((c) => c.messageId)).toEqual([first]);
    expect(t.adapter.sent.length).toBe(1);
    expect(t.adapter.edited.length).toBe(0);
    await t.stop();
  });

  test('tapping a button on an OLD (pushed-past) message acts on that message, not the current screen', async () => {
    const deleted: string[] = [];
    function Item() {
      const { id } = useParams();
      const navigate = useNavigate();
      return (
        <Message text={`item ${id}`}>
          <InlineKeyboard>
            <Button text="Delete" onClick={() => { deleted.push(id); }} />
            <Button text="Next" onClick={() => navigate(`/item/${Number(id) + 1}`, { mode: 'push' })} />
          </InlineKeyboard>
        </Message>
      );
    }
    const router = createRouter({ '/': () => <Message text="home" />, '/item/:id': Item });
    const t = await createTestBot({ router, commands: { item: { description: 'i', route: '/item/1' } } });
    await t.send('/item');
    const old = t.lastMessage!;
    await t.click('Next'); // now showing item 2 in a NEW message; item 1 message still has buttons
    expect(t.lastMessage?.text).toBe('item 2');
    // User scrolls up and taps "Delete" on the item-1 message.
    const del = old.buttons[0][0];
    await t.adapter.simulateCallback('1', '1', del.data!, String(old.id), { callbackLabel: del.text });
    // Must never delete item 2 (the one the user did NOT tap). Either delete 1 or ignore.
    expect(deleted).not.toContain('2');
    await t.stop();
  });
});

describe('commands', () => {
  function app() {
    return createRouter({
      '/': () => <Message text="home" />,
      '/item/:id': ItemPage,
    }, { notFound: () => <Message text="404" /> });
  }

  test('/start@ThisBot works (case-insensitive) and /start@OtherBot is ignored', async () => {
    const t = await createTestBot({ router: app(), chatId: '-100', commands: { start: { description: 's', route: '/' } } });
    await t.adapter.simulateMessage('-100', '1', '/start@OtherBot', { botUsername: 'ThisBot' });
    expect(t.adapter.sent.length).toBe(0);
    await t.adapter.simulateMessage('-100', '1', '/START@thisbot', { botUsername: 'ThisBot' });
    expect(t.lastMessage?.text).toBe('home');
    await t.stop();
  });

  test('"/ start", "  /start" and a plain message are not commands', async () => {
    let calls = 0;
    const t = await createTestBot({ router: app(), commands: { start: { description: 's', handler: () => { calls++; } } } });
    await t.send('/ start');
    await t.send('  /start');
    await t.send('start');
    expect(calls).toBe(0);
    await t.send('/start');
    expect(calls).toBe(1);
    await t.stop();
  });

  test('invalid command names are skipped, uppercase names normalized', async () => {
    let upper = 0;
    const { warns } = await captureConsole(async () => {
      const t = await createTestBot({
        router: app(),
        commands: {
          'my-cmd': { description: 'bad', handler: 'x' },
          Upper: { description: 'u', handler: () => { upper++; } },
        },
      });
      await t.send('/upper');
      await t.send('/my-cmd');
      expect(t.adapter.sent.length).toBe(1); // only the home render for '/my-cmd' (not a command)
      await t.stop();
    });
    expect(upper).toBe(1);
    expect(warns.some((w) => w.includes('my-cmd'))).toBe(true);
  });

  test('throwing handler → onError("command"), bot keeps working', async () => {
    const errs: string[] = [];
    const t = await createTestBot({
      router: app(),
      onError: (_e, { source }) => errs.push(source),
      commands: { boom: { description: 'b', handler: async () => { throw new Error('x'); } }, start: { description: 's', route: '/' } },
    });
    await t.send('/boom');
    expect(errs).toEqual(['command']);
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('home');
    await t.stop();
  });

  test('string handler replies; hidden command works but is not registered', async () => {
    const t = await createTestBot({
      router: app(),
      commands: { help: { description: 'h', handler: 'Help text' }, secret: { description: 's', handler: 'shh', hidden: true } },
    });
    expect(t.adapter.commands.map((c) => c.command)).toEqual([]); // fetch() skips registration
    await t.send('/help');
    expect(t.lastMessage?.text).toBe('Help text');
    await t.send('/secret');
    expect(t.lastMessage?.text).toBe('shh');
    await t.stop();
  });

  test('hidden commands are excluded from setCommands on start()', async () => {
    const { createBot } = await import('../packages/core/src');
    const { MockAdapter } = await import('../packages/testing/src');
    const adapter = new MockAdapter();
    const bot = createBot({ adapter, token: 't', router: app(), commands: { help: { description: 'h', handler: 'x' }, secret: { description: 's', handler: 'y', hidden: true } } });
    await captureConsole(async () => { await bot.start(); });
    expect(adapter.commands.map((c) => c.command)).toEqual(['help']);
    await captureConsole(async () => { await bot.stop(); });
  });

  test('handler args are split on whitespace', async () => {
    let got: string[] = [];
    const t = await createTestBot({ router: app(), commands: { echo: { description: 'e', handler: (c) => { got = c.args; } } } });
    await t.send('/echo   a \n  b\tc ');
    expect(got).toEqual(['a', 'b', 'c']);
    await t.stop();
  });

  describe('deep links', () => {
    const deepLinkBot = (seen: string[][]) => createTestBot({
      router: app(),
      commands: { start: { description: 's', route: '/', deepLink: (args) => { seen.push(args); return `/item/${args[0]}`; } } },
    });

    test('injection payload "../admin" never escapes the item route', async () => {
      const seen: string[][] = [];
      const t = await deepLinkBot(seen);
      await t.send('/start ../admin');
      expect(seen).toEqual([['../admin']]);
      expect(t.lastMessage?.text).toBe('404');
      await t.stop();
    });

    test('unicode and very long payloads arrive raw', async () => {
      const seen: string[][] = [];
      const t = await deepLinkBot(seen);
      await t.send('/start ünï🔥');
      expect(t.lastMessage?.text).toBe('item="ünï🔥"');
      const long = 'A'.repeat(5000);
      await t.send(`/start ${long}`);
      expect(t.lastMessage?.text).toBe(`item=${JSON.stringify(long)}`);
      await t.stop();
    });

    test('a throwing deepLink reports "command" and falls back to the route', async () => {
      const errs: string[] = [];
      const t = await createTestBot({
        router: app(), onError: (_e, { source }) => errs.push(source),
        commands: { start: { description: 's', route: '/', deepLink: () => { throw new Error('bad'); } } },
      });
      await t.send('/start xyz');
      expect(errs).toEqual(['command']);
      expect(t.lastMessage?.text).toBe('home');
      await t.stop();
    });
  });

  test('a handler command does not break buttons of the screen above it', async () => {
    const log: string[] = [];
    const router = createRouter({
      '/': () => <Message text="menu"><InlineKeyboard><Button text="Ping" onClick={() => log.push('ping')} /></InlineKeyboard></Message>,
    });
    const t = await createTestBot({ router, commands: { help: { description: 'h', handler: 'help' } } });
    await t.send('/start');
    const menu = t.lastMessage!;
    await t.send('/help');
    await t.adapter.simulateCallback('1', '1', menu.buttons[0][0].data!, String(menu.id), { callbackLabel: 'Ping' });
    expect(log).toEqual(['ping']);
    await t.stop();
  });
});

describe('middleware & plugins', () => {
  const Home = () => <Message text="home" />;

  test('throwing middleware is reported and the next update still works', async () => {
    const errs: string[] = [];
    let n = 0;
    const mw: Middleware = () => { if (n++ === 0) throw new Error('mw'); };
    const t = await createTestBot({ component: Home, middleware: [mw], onError: (_e, { source }) => errs.push(source) });
    await t.send('hi');
    expect(errs).toEqual(['middleware']);
    expect(t.adapter.sent.length).toBe(0);
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('home');
    await t.stop();
  });

  test('middleware returning false stops commands too', async () => {
    let calls = 0;
    const t = await createTestBot({ component: Home, middleware: [() => false], commands: { x: { description: 'x', handler: () => { calls++; } } } });
    await t.send('/x');
    expect(calls).toBe(0);
    expect(t.adapter.sent.length).toBe(0);
    await t.stop();
  });

  test('next() called twice is reported, update rendered once', async () => {
    const errs: unknown[] = [];
    const mw: Middleware = async (_c, next) => { await next(); await next(); };
    const t = await createTestBot({ component: Home, middleware: [mw], onError: (e) => errs.push(e) });
    await t.send('hi');
    expect(t.adapter.sent.length).toBe(1);
    expect(String(errs[0])).toContain('next() called multiple times');
    await t.stop();
  });

  test('a middleware that calls next() without awaiting it still completes the update before send() resolves', async () => {
    const mw: Middleware = (_c, next) => { void next(); };
    const t = await createTestBot({ component: Home, middleware: [mw] });
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('home');
    await t.stop();
  });

  test('plugin middleware runs before user middleware', async () => {
    const order: string[] = [];
    const plugin: TeactPlugin = { name: 'p', middleware: async () => { order.push('plugin'); } };
    const t = await createTestBot({ component: Home, plugins: [plugin], middleware: [() => { order.push('user'); }] });
    await t.send('hi');
    expect(order).toEqual(['plugin', 'user']);
    await t.stop();
  });

  test('loggerPlugin logs and does not swallow the pipeline', async () => {
    const lines: string[] = [];
    const t = await createTestBot({ component: Home, plugins: [loggerPlugin({ log: (l) => lines.push(l) })] });
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('home');
    expect(lines[0]).toContain('"hi"');
    await t.stop();
  });

  test('rateLimitPlugin limits per user in groups, resets after the window, survives onLimited throwing', async () => {
    let limitedCalls = 0;
    const t = await createTestBot({
      component: Home, chatId: '-1',
      plugins: [rateLimitPlugin({ limit: 2, windowMs: 80, onLimited: () => { limitedCalls++; throw new Error('boom'); } })],
    });
    await captureConsole(async () => {
      await t.adapter.simulateMessage('-1', 'a', 'x');
      await t.adapter.simulateMessage('-1', 'a', 'x');
      await t.adapter.simulateMessage('-1', 'a', 'x'); // dropped
      await t.adapter.simulateMessage('-1', 'b', 'x'); // other user unaffected
    });
    expect(t.adapter.sent.length).toBe(3);
    expect(limitedCalls).toBe(1);
    await sleep(100);
    await t.adapter.simulateMessage('-1', 'a', 'x');
    expect(t.adapter.sent.length).toBe(4);
    await t.stop();
  });

  test('rateLimitPlugin onLimited string reply goes to the chat', async () => {
    const t = await createTestBot({ component: Home, plugins: [rateLimitPlugin({ limit: 1, windowMs: 1000, onLimited: () => 'slow down' })] });
    await t.send('x');
    await t.send('x');
    expect(t.apiCalls.find((c) => c.method === 'sendMessage')?.params.text).toBe('slow down');
    await t.stop();
  });
});

describe('errors, boundaries & suspense', () => {
  test('render error shows the fallback; the NEXT update recovers with a fresh root', async () => {
    let crash = true;
    const errs: string[] = [];
    function Page() {
      if (crash) throw new Error('kaboom');
      return <Message text="ok" />;
    }
    const t = await createTestBot({ component: Page, onError: (_e, { source }) => errs.push(source) });
    await captureConsole(async () => { await t.send('hi'); });
    expect(errs).toContain('render');
    expect(t.lastMessage?.text).toContain('Something went wrong');
    crash = false;
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('ok');
    await t.stop();
  });

  test('default error fallback does not leak internal error messages to end users', async () => {
    function Page(): React.ReactElement { throw new Error('postgres://admin:hunter2@db/prod refused'); }
    const t = await createTestBot({ component: Page, onError: () => {} });
    await captureConsole(async () => { await t.send('hi'); });
    expect(t.lastMessage?.text).not.toContain('hunter2');
    await t.stop();
  });

  test('sync & async click handler errors are reported and the UI keeps working', async () => {
    const errs: string[] = [];
    function Page() {
      const [n, setN] = useState(0);
      return (
        <Message text={`n=${n}`}>
          <InlineKeyboard>
            <Button text="sync" onClick={() => { throw new Error('s'); }} />
            <Button text="async" onClick={async () => { await sleep(1); throw new Error('a'); }} />
            <Button text="inc" onClick={() => setN(n + 1)} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Page, onError: (_e, { source }) => errs.push(source) });
    await t.send('hi');
    await t.click('sync');
    await t.click('async');
    await t.click('inc');
    expect(errs).toEqual(['handler', 'handler']);
    expect(t.lastMessage?.text).toBe('n=1');
    await t.stop();
  });

  test('an error in useEffect is caught and the chat recovers', async () => {
    let crash = true;
    const errs: string[] = [];
    function Page() {
      useEffect(() => { if (crash) throw new Error('effect'); }, []);
      return <Message text="page" />;
    }
    const t = await createTestBot({ component: Page, onError: (_e, { source }) => errs.push(source) });
    await captureConsole(async () => { await t.send('hi'); await sleep(20); });
    expect(errs).toContain('render');
    crash = false;
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('page');
    await t.stop();
  });

  test('component that throws only on the second render: fallback, then recovery', async () => {
    const errs: string[] = [];
    let renders = 0;
    function Page() {
      const [n, setN] = useState(0);
      if (n === 1 && renders++ < 1000) throw new Error('second');
      return <Message text={`n=${n}`}><InlineKeyboard><Button text="inc" onClick={() => setN(n + 1)} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: Page, onError: (_e, { source }) => errs.push(source) });
    await t.send('hi');
    await captureConsole(async () => { await t.click('inc'); });
    expect(errs).toContain('render');
    expect(t.lastMessage?.text).toContain('Something went wrong');
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('n=0');
    await t.stop();
  });

  test('user ErrorBoundary inside the tree can retry', async () => {
    let crash = true;
    function Bad() { if (crash) throw new Error('x'); return <Message text="good" />; }
    function Page() {
      return (
        <ErrorBoundary fallback={(_e: Error, retry: () => void) => (
          <Message text="oops"><InlineKeyboard><Button text="retry" onClick={() => { crash = false; retry(); }} /></InlineKeyboard></Message>
        )}>
          <Bad />
        </ErrorBoundary>
      );
    }
    const t = await createTestBot({ component: Page });
    await captureConsole(async () => { await t.send('hi'); });
    expect(t.lastMessage?.text).toBe('oops');
    await t.click('retry');
    expect(t.lastMessage?.text).toBe('good');
    await t.stop();
  });

  test('Suspense with use(): fallback first, then content edited in', async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => { resolve = r; });
    function Data() { const v = use(p); return <Message text={`data:${v}`} />; }
    const t = await createTestBot({ component: () => <Suspense fallback={<Message text="loading" />}><Data /></Suspense> });
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('loading');
    resolve('42');
    await waitUntil(() => t.lastMessage?.text === 'data:42');
    expect(t.messages.length).toBe(1);
    await t.stop();
  });

  test('Suspense promise that rejects reaches the error boundary', async () => {
    const errs: string[] = [];
    let reject!: (e: Error) => void;
    const p = new Promise<string>((_r, j) => { reject = j; });
    function Data() { const v = use(p); return <Message text={v} />; }
    const t = await createTestBot({ component: () => <Suspense fallback={<Message text="loading" />}><Data /></Suspense>, onError: (_e, { source }) => errs.push(source) });
    await t.send('hi');
    await captureConsole(async () => { reject(new Error('fetch failed')); await waitUntil(() => errs.length > 0); });
    expect(errs).toEqual(['render']);
    await waitUntil(() => !!t.lastMessage?.text.includes('Something went wrong'));
    await t.stop();
  });

  test('very deep component tree renders', async () => {
    function Deep({ d }: { d: number }): React.ReactElement {
      return d === 0 ? <Message text="bottom" /> : <Deep d={d - 1} />;
    }
    const t = await createTestBot({ component: () => <Deep d={3000} /> });
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('bottom');
    await t.stop();
  });
});

describe('keyboards & callback aliasing', () => {
  test('more than 100 inline buttons triggers a warning (Telegram rejects >100)', async () => {
    function Big() {
      return <Message text="big"><InlineKeyboard>{Array.from({ length: 101 }, (_, i) => <Button key={i} text={`b${i}`} onClick={() => {}} />)}</InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: Big });
    await t.send('hi');
    const { warns } = await captureConsole(async () => serializeOutput(t.lastMessage!.output));
    expect(warns.some((w) => /100/.test(w))).toBe(true);
    await t.stop();
  });

  test('1000+ distinct long-data buttons across screens: aliases are bounded; the latest ones keep working', async () => {
    const hits: string[] = [];
    let page = 0;
    function Pager() {
      const [p, setP] = useState(0);
      page = p;
      return (
        <Message text={`page ${p}`}>
          <InlineKeyboard>
            {Array.from({ length: 50 }, (_, i) => <Button key={i} text={`i${i}`} onClick={`${'L'.repeat(70)}-${p}-${i}`} />)}
            <Button text="next" onClick={() => setP(p + 1)} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Pager, middleware: [(ctx) => { if (ctx.callbackData?.startsWith('L')) hits.push(ctx.callbackData); }] });
    await t.send('hi');
    for (let i = 0; i < 25; i++) await t.click('next');
    expect(page).toBe(25);
    await t.click('i3');
    expect(hits.at(-1)).toBe(`${'L'.repeat(70)}-25-3`);
    const aliases = (t.bot as any)._chatRoots; // sanity: bot alive
    expect(aliases.size).toBe(1);
    await t.stop();
  });

  test('a long route button sent via bot.send into a forum topic still routes when tapped there', async () => {
    const long = 'z'.repeat(100);
    const router = createRouter({ '/': () => <Message text="home" />, '/item/:id': ItemPage });
    const t = await createTestBot({ router });
    await t.bot.send('1', <Message text="notify"><InlineKeyboard><Button text="Open" route="/item/:id" params={{ id: long }} /></InlineKeyboard></Message>, { threadId: 7 });
    const btn = t.lastMessage!.buttons[0][0];
    await t.adapter.simulateCallback('1', '1', btn.data!, String(t.lastMessage!.id), { threadId: 7 });
    expect(t.lastMessage?.text).toBe(`item=${JSON.stringify(long)}`);
    await t.stop();
  });

  test('a long route button keeps working after a restart (fresh instance, shared store)', async () => {
    const long = 'q'.repeat(100);
    const router = createRouter({ '/': linkMenu({ id: long }), '/item/:id': ItemPage });
    const store = sharedStore();
    const a = await createTestBot({ router, session: { store } });
    await a.send('/start');
    const msg = a.lastMessage!;
    await a.stop();
    const b = await createTestBot({ router, session: { store } });
    await b.adapter.simulateCallback('1', '1', msg.buttons[0][0].data!, String(msg.id), { callbackLabel: 'Open' });
    expect(b.lastMessage?.text).toBe(`item=${JSON.stringify(long)}`);
    await b.stop();
  });
});

describe('concurrency', () => {
  test('20 un-awaited messages to one chat are processed in order', async () => {
    const order: string[] = [];
    const t = await createTestBot({
      component: () => <Message text="x" />,
      commands: { n: { description: 'n', handler: async (c) => { await sleep(Math.random() * 5); order.push(c.args[0]); await c.reply(`r${c.args[0]}`); } } },
    });
    await Promise.all(Array.from({ length: 20 }, (_, i) => t.adapter.simulateMessage('1', '1', `/n ${i}`)));
    const expected = Array.from({ length: 20 }, (_, i) => String(i));
    expect(order).toEqual(expected);
    expect(t.adapter.sent.map((s) => (s.output.props as any).text)).toEqual(expected.map((i) => `r${i}`));
    await t.stop();
  });

  test.todo('caption commands ("/start" in a photo caption) — adapter only reads msg.text; Telegram treats caption bot_command entities as commands', () => {});
  test.todo('callback aliases live only in memory: >1000 distinct long callbacks per chat evicts the oldest (old messages\' long buttons silently die)', () => {});
});
