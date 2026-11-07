import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { authPlugin, useAuth, useAuthSession, createRouter, useNavigate, redirect } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot } from '../packages/testing/src';

const GROUP = '-100123';
const ADMIN = '1';
const MALLORY = '666';

describe('auth in group chats (attack scenarios)', () => {
  test('a non-admin tapping an admin-only button must not run it', async () => {
    let wiped = 0;
    function AdminPanel() {
      const { isAdmin } = useAuth();
      return (
        <Message text={isAdmin ? 'Admin panel' : 'Hello'}>
          {isAdmin ? <InlineKeyboard><Button text="Wipe DB" onClick={() => { wiped++; }} /></InlineKeyboard> : null}
        </Message>
      );
    }
    const t = await createTestBot({ component: AdminPanel, chatId: GROUP, userId: ADMIN, plugins: [authPlugin({ admins: [ADMIN] })] });
    await t.send('/panel'); // admin opens the panel in the group
    const wipe = t.lastMessage!.buttons[0][0];
    await t.adapter.simulateCallback(GROUP, MALLORY, wipe.data!, String(t.lastMessage!.id)); // Mallory taps it
    expect(wiped).toBe(0);
    await t.stop();
  });

  test("one member's useAuthSession login must not log in the whole group", async () => {
    function Account() {
      const auth = useAuthSession();
      return (
        <Message text={auth.isAuthenticated ? 'logged in' : 'logged out'}>
          <InlineKeyboard><Button text="login" onClick={() => auth.login({ accessToken: 'secret-token' })} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Account, chatId: GROUP, userId: ADMIN });
    await t.send('hi');
    await t.click('login');
    expect(t.lastMessage?.text).toBe('logged in');
    await t.adapter.simulateMessage(GROUP, MALLORY, 'hi'); // someone else talks in the group
    expect(t.lastMessage?.text).toBe('logged out');
    await t.stop();
  });

  test('route guards can authorize the requesting user, not just the chat', async () => {
    const seen: string[] = [];
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/admin': {
        component: () => <Message text="admin area" />,
        beforeLoad: (ctx: any) => { seen.push(String(ctx.user?.id)); if (ctx.user?.id !== ADMIN) return redirect('/'); },
      },
    });
    const t = await createTestBot({ router, chatId: GROUP, userId: ADMIN, commands: { admin: { description: 'a', route: '/admin' } } });
    await t.adapter.simulateMessage(GROUP, MALLORY, '/admin');
    expect(t.lastMessage?.text).toBe('home');
    await t.send('/admin');
    expect(t.lastMessage?.text).toBe('admin area');
    expect(seen).toEqual([MALLORY, ADMIN]);
    await t.stop();
  });
});

describe('auth hardening keeps legitimate use working', () => {
  test('buttons everyone can see still work for everyone in a group (votes, games)', async () => {
    const votes: string[] = [];
    function Vote() {
      const [n, setN] = useState(0);
      return (
        <Message text={`votes: ${n}`}>
          <InlineKeyboard><Button text="👍" onClick={() => { votes.push('x'); setN((v) => v + 1); }} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Vote, chatId: GROUP, userId: ADMIN });
    await t.send('/vote');
    const msg = String(t.lastMessage!.id);
    const data = t.lastMessage!.buttons[0][0].data!;
    for (const user of ['2', '3', ADMIN, '4']) await t.adapter.simulateCallback(GROUP, user, data, msg);
    expect(votes).toHaveLength(4);
    expect(t.lastMessage?.text).toBe('votes: 4');
    await t.stop();
  });

  test('roles: a moderator can use moderator buttons; admins can use everything; others nothing', async () => {
    const actions: string[] = [];
    function Mod() {
      const auth = useAuth();
      return (
        <Message text={`role: ${auth.role ?? 'none'}`}>
          <InlineKeyboard>
            {auth.is('moderator') ? <Button text="Ban" onClick={() => actions.push(`ban by ${auth.userId}`)} /> : null}
            {auth.isAdmin ? <Button text="Nuke" onClick={() => actions.push(`nuke by ${auth.userId}`)} /> : null}
            <Button text="Ping" onClick={() => actions.push(`ping by ${auth.userId}`)} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({
      component: Mod, chatId: GROUP, userId: ADMIN,
      plugins: [authPlugin({ admins: [Number(ADMIN)], roles: { moderator: ['7'] } })],
    });
    await t.send('/mod');
    const id = String(t.lastMessage!.id);
    const [ban, nuke, ping] = t.lastMessage!.buttons.flat().map((b) => b.data!);
    await t.adapter.simulateCallback(GROUP, '7', ban, id);      // moderator → allowed
    await t.adapter.simulateCallback(GROUP, '7', nuke, id);     // moderator → not admin
    await t.adapter.simulateCallback(GROUP, MALLORY, ban, id);  // nobody
    await t.adapter.simulateCallback(GROUP, MALLORY, ping, id); // public button
    // The shared message now shows the last actor's view (no admin buttons), so the admin
    // reopens the panel and taps the fresh button.
    await t.adapter.simulateMessage(GROUP, ADMIN, '/mod');
    const fresh = t.lastMessage!;
    const freshNuke = fresh.buttons.flat().find((b) => b.text === 'Nuke')!.data!;
    await t.adapter.simulateCallback(GROUP, ADMIN, freshNuke, String(fresh.id));
    void nuke;
    expect(actions).toEqual(['ban by 7', `ping by ${MALLORY}`, `nuke by ${ADMIN}`]);
    await t.stop();
  });

  test('private chats skip the authorization pre-render (one edit per tap)', async () => {
    function Counter() {
      const [n, setN] = useState(0);
      return <Message text={`n=${n}`}><InlineKeyboard><Button text="+" onClick={() => setN(n + 1)} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: Counter });
    await t.send('hi');
    await t.click('+');
    await t.click('+');
    expect(t.adapter.edited).toHaveLength(2);
    expect(t.lastMessage?.text).toBe('n=2');
    await t.stop();
  });

  test("a cross-user tap that does nothing sends nothing extra (the silent pre-render isn't sent)", async () => {
    let wiped = 0;
    function Panel() {
      const { isAdmin } = useAuth();
      return <Message text={isAdmin ? 'admin view' : 'member view'}>{isAdmin ? <InlineKeyboard><Button text="Wipe" onClick={() => { wiped++; }} /></InlineKeyboard> : null}</Message>;
    }
    const t = await createTestBot({ component: Panel, chatId: GROUP, userId: ADMIN, plugins: [authPlugin({ admins: [ADMIN] })] });
    await t.send('/p');
    const before = t.adapter.sent.length + t.adapter.edited.length;
    await t.adapter.simulateCallback(GROUP, MALLORY, t.lastMessage!.buttons[0][0].data!, String(t.lastMessage!.id));
    expect(wiped).toBe(0);
    // exactly one visible update: the shared message now reflects the last actor's view
    expect(t.adapter.sent.length + t.adapter.edited.length - before).toBe(1);
    await t.stop();
  });
});

describe('useAuthSession', () => {
  function Account() {
    const auth = useAuthSession();
    return (
      <Message text={auth.isAuthenticated ? `in:${auth.accessToken}` : 'out'}>
        <InlineKeyboard>
          <Button text="login-expired" onClick={() => auth.login({ accessToken: 'old', expiresAt: Date.now() - 1000 })} />
          <Button text="refresh" onClick={() => auth.setAccessToken('fresh', Date.now() + 60_000)} />
          <Button text="logout" onClick={() => auth.logout()} />
        </InlineKeyboard>
      </Message>
    );
  }

  test('expired tokens are not authenticated; refresh restores; logout clears', async () => {
    const t = await createTestBot({ component: Account });
    await t.send('hi');
    await t.click('login-expired');
    expect(t.lastMessage?.text).toBe('out');
    await t.click('refresh');
    expect(t.lastMessage?.text).toBe('in:fresh');
    await t.click('logout');
    expect(t.lastMessage?.text).toBe('out');
    await t.stop();
  });

  test('a login survives a bot restart with a durable session store', async () => {
    const data = new Map<string, any>();
    const store = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: any) => { data.set(k, JSON.parse(JSON.stringify(v))); }, delete: async (k: string) => { data.delete(k); } };
    const a = await createTestBot({ component: Account, session: { store } });
    await a.send('hi'); await a.click('refresh');
    expect(a.lastMessage?.text).toBe('in:fresh');
    await a.stop();
    const b = await createTestBot({ component: Account, session: { store } });
    await b.send('hi');
    expect(b.lastMessage?.text).toBe('in:fresh');
    await b.stop();
  });
});

describe('useAuth misuse', () => {
  test('useAuth without authPlugin shows a clear error, not a crash', async () => {
    const errors: string[] = [];
    const t = await createTestBot({ component: () => { useAuth(); return <Message text="x" />; }, onError: (e) => errors.push((e as Error).message) });
    await t.send('hi');
    expect(errors[0]).toMatch(/authPlugin/);
    expect(t.lastMessage?.text).toContain('Something went wrong');
    await t.stop();
  });
});

describe('route guard redirects', () => {
  test('a denied navigation is not "pending": logging in later must not teleport the user', async () => {
    const { useSession } = await import('../packages/core/src');
    function Home() {
      const [session, setSession] = useSession<{ token?: string }>();
      const navigate = useNavigate();
      return (
        <Message text={`home (${session.token ? 'in' : 'out'})`}>
          <InlineKeyboard>
            <Button text="members" onClick={() => navigate('/members')} />
            <Button text="login" onClick={() => setSession({ token: 't' })} />
          </InlineKeyboard>
        </Message>
      );
    }
    const router = createRouter({
      '/': Home,
      '/members': { component: () => <Message text="members area" />, beforeLoad: ({ session }) => (session.token ? undefined : redirect('/')) },
    });
    const t = await createTestBot({ router });
    await t.send('hi');
    await t.click('members');             // denied → home
    expect(t.lastMessage?.text).toBe('home (out)');
    await t.click('login');               // must stay on home
    expect(t.lastMessage?.text).toBe('home (in)');
    await t.click('members');             // now allowed
    expect(t.lastMessage?.text).toBe('members area');
    await t.stop();
  });
});
