import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createRouter, useNavigate, kvSessionStore } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot } from '../packages/testing/src';

/** A durable session store shared by "instances" (like Redis/KV across serverless isolates). */
function sharedStore() {
  const data = new Map<string, string>();
  return kvSessionStore({ get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } });
}

describe('fresh roots (serverless instance / restarted bot)', () => {
  test('a tap on a message rendered by another instance still runs its handler', async () => {
    const log: string[] = [];
    function Menu() {
      return (
        <Message text="menu">
          <InlineKeyboard>
            <Button text="Ping" onClick={() => log.push('ping')} />
            <Button text="Pong" onClick={() => log.push('pong')} />
          </InlineKeyboard>
        </Message>
      );
    }
    const store = sharedStore();
    const a = await createTestBot({ component: Menu, session: { store } });
    await a.send('hi');
    const msg = a.lastMessage!;
    await a.stop();
    // Instance B never rendered this chat; the user taps "Pong" on A's message.
    const b = await createTestBot({ component: Menu, session: { store } });
    const pong = msg.buttons.flat().find((x) => x.text === 'Pong')!;
    await b.adapter.simulateCallback('1', '1', pong.data!, String(msg.id), { callbackLabel: 'Pong' });
    expect(log).toEqual(['pong']);
    await b.stop();
  });

  test('a stale tap whose button now means something else is ignored (label check)', async () => {
    const opened: string[] = [];
    function List() {
      const [page, setPage] = useState(0);
      const items = [0, 1, 2].map((i) => `#${page * 10 + i + 1}`);
      return (
        <Message text={`page ${page + 1}`}>
          <InlineKeyboard>
            {items.map((it) => <Button key={it} text={it} onClick={() => opened.push(it)} />)}
            <Button text="next" onClick={() => setPage((p) => p + 1)} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: List });
    await t.send('hi');
    await t.click('next');                       // page 2: "#11", "#12", "#13"
    const page2 = t.lastMessage!;
    const eleven = page2.buttons.flat().find((x) => x.text === '#11')!;
    await t.send('restart-ish');                 // a new message → new screen on page 1 (fresh state)
    // The user taps "#11" on the OLD page-2 message; the same callback data is "#1" now.
    await t.adapter.simulateCallback('1', '1', eleven.data!, String(page2.id), { callbackLabel: '#11' });
    expect(opened).not.toContain('#1');
    await t.stop();
  });

  test('the router reopens the screen the user was on', async () => {
    function Home() { const nav = useNavigate(); return <Message text="home"><InlineKeyboard><Button text="settings" onClick={() => nav('/settings')} /></InlineKeyboard></Message>; }
    function Settings() { return <Message text="settings screen" />; }
    const router = createRouter({ '/': Home, '/settings': Settings });
    const store = sharedStore();
    const a = await createTestBot({ router, session: { store } });
    await a.send('hi');
    await a.click('settings');
    await a.stop();
    const b = await createTestBot({ router, session: { store } });
    await b.send('hello again');                // no command → restore, not the default route
    expect(b.lastMessage?.text).toBe('settings screen');
    await b.send('/start');                     // unknown command falls through, but a known one wins:
    await b.stop();
    const c = await createTestBot({ router, session: { store }, commands: { start: { description: 's', route: '/' } } });
    await c.send('/start');
    expect(c.lastMessage?.text).toBe('home');
    await c.stop();
  });

  test('a restored route still passes through its guard', async () => {
    let allowed = true;
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/vip': { component: () => <Message text="vip" />, beforeLoad: () => (allowed ? undefined : '/') },
    });
    const store = sharedStore();
    const a = await createTestBot({ router, session: { store }, commands: { vip: { description: 'v', route: '/vip' } } });
    await a.send('/vip');
    expect(a.lastMessage?.text).toBe('vip');
    await a.stop();
    allowed = false; // e.g. subscription expired
    const b = await createTestBot({ router, session: { store } });
    await b.send('hi');
    expect(b.lastMessage?.text).toBe('home');
    await b.stop();
  });
});
