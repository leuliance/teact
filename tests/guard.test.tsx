import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/renderer/src';
import { RuntimeContext, type RuntimeContextValue } from '../packages/runtime/src/context';
import {
  createRouter, RouterProvider, CommitModeCtx, redirect,
  type CommitModeRef, type GuardRedirect,
} from '../packages/runtime/src/router';
import type { BotContext } from '../packages/renderer/src';

const waitForCommit = (ms = 15) => new Promise<void>(r => setTimeout(r, ms));

function makeRuntimeValue(session: Record<string, any> = {}): RuntimeContextValue {
  return {
    botCtx: {
      chatId: '1', userId: '1',
      user: { id: '1', platform: 'telegram' },
      platform: 'telegram', raw: null,
    },
    session,
    updateSession: () => {},
    command: null,
  };
}

function renderWithRouter(
  config: ReturnType<typeof createRouter>,
  initialPath: string,
  session: Record<string, any> = {},
) {
  let output: OutputNode | null = null;
  const commitMode: CommitModeRef = { current: 'replace' };
  const root = createRoot((tree) => { output = tree; });
  root.render(
    React.createElement(
      CommitModeCtx.Provider,
      { value: commitMode },
      React.createElement(
        RuntimeContext.Provider,
        { value: makeRuntimeValue(session) },
        React.createElement(RouterProvider, { config, initialPath }),
      ),
    ),
  );
  return { root, getOutput: () => output };
}

function Home() {
  return React.createElement('tg-message', { text: 'Home' });
}

function Admin() {
  return React.createElement('tg-message', { text: 'Admin Panel' });
}

function Login() {
  return React.createElement('tg-message', { text: 'Login Required' });
}

function Dashboard() {
  return React.createElement('tg-message', { text: 'Dashboard' });
}

function Premium() {
  return React.createElement('tg-message', { text: 'Premium Content' });
}

describe('Route guards — string redirect', () => {
  const router = createRouter({
    '/': Home,
    '/login': Login,
    '/admin': {
      component: Admin,
      beforeLoad: ({ session }) => {
        if (!session.isAdmin) return redirect('/login');
      },
    },
  });

  test('redirects unauthenticated user to login', async () => {
    const { getOutput } = renderWithRouter(router, '/admin', { isAdmin: false });
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Login Required');
  });

  test('allows authenticated admin through', async () => {
    const { getOutput } = renderWithRouter(router, '/admin', { isAdmin: true });
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Admin Panel');
  });

  test('guard returning undefined allows through', async () => {
    const router2 = createRouter({
      '/': Home,
      '/dashboard': {
        component: Dashboard,
        beforeLoad: () => { /* void - allow */ },
      },
    });
    const { getOutput } = renderWithRouter(router2, '/dashboard');
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Dashboard');
  });
});

describe('Route guards — GuardRedirect object', () => {
  const router = createRouter({
    '/': Home,
    '/login': Login,
    '/premium': {
      component: Premium,
      beforeLoad: ({ session }): string | GuardRedirect | void => {
        if (!session.isPremium) {
          return { redirect: '/login', message: 'Please subscribe' };
        }
      },
    },
  });

  test('GuardRedirect object redirects', async () => {
    const { getOutput } = renderWithRouter(router, '/premium', { isPremium: false });
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Login Required');
  });

  test('GuardRedirect allows premium user through', async () => {
    const { getOutput } = renderWithRouter(router, '/premium', { isPremium: true });
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Premium Content');
  });
});

describe('Route guards — chained redirects', () => {
  test('chain of redirects resolves correctly', async () => {
    const router = createRouter({
      '/': Home,
      '/login': Login,
      '/step1': {
        component: Home,
        beforeLoad: () => redirect('/step2'),
      },
      '/step2': {
        component: Home,
        beforeLoad: () => redirect('/login'),
      },
    });
    const { getOutput } = renderWithRouter(router, '/step1');
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Login Required');
  });

  test('redirect loop (max 5 iterations) falls to NotFound', async () => {
    const router = createRouter({
      '/': Home,
      '/a': {
        component: Home,
        beforeLoad: () => redirect('/b'),
      },
      '/b': {
        component: Home,
        beforeLoad: () => redirect('/a'),
      },
    });
    const { getOutput } = renderWithRouter(router, '/a');
    await waitForCommit();
    const output = getOutput();
    expect(output!.props.text).toContain('Page not found');
  });
});

describe('Route guards — no guard', () => {
  const router = createRouter({
    '/': Home,
    '/admin': Admin,
    '/dashboard': Dashboard,
  });

  test('route without guard renders normally', async () => {
    const { getOutput } = renderWithRouter(router, '/admin');
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Admin Panel');
  });

  test('root route renders normally', async () => {
    const { getOutput } = renderWithRouter(router, '/');
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Home');
  });
});

describe('Route guards — guard with session data', () => {
  test('guard can read session values', async () => {
    let capturedSession: Record<string, any> = {};
    const router = createRouter({
      '/': Home,
      '/profile': {
        component: Dashboard,
        beforeLoad: ({ session }) => {
          capturedSession = session;
          if (!session.loggedIn) return redirect('/');
        },
      },
    });

    renderWithRouter(router, '/profile', { loggedIn: false, username: 'alice' });
    await waitForCommit();
    expect(capturedSession.loggedIn).toBe(false);
    expect(capturedSession.username).toBe('alice');
  });

  test('guard receives correct path and params', async () => {
    let capturedPath = '';
    let capturedParams: Record<string, string> = {};
    const router = createRouter({
      '/': Home,
      '/user/:id': {
        component: Dashboard,
        beforeLoad: ({ path, params }) => {
          capturedPath = path;
          capturedParams = params;
        },
      },
    });

    renderWithRouter(router, '/user/42');
    await waitForCommit();
    expect(capturedPath).toBe('/user/42');
    expect(capturedParams.id).toBe('42');
  });
});

describe('Route guards — reply()', () => {
  test('reply() renders a message instead of the route', async () => {
    const router = createRouter({
      '/': Home,
      '/vip': {
        component: Premium,
        beforeLoad: ({ session, reply }) => {
          if (!session.vip) return reply('Access denied. Please upgrade.', {
            buttons: [[{ text: 'Upgrade', route: '/upgrade' }]],
          });
        },
      },
    });
    const { getOutput } = renderWithRouter(router, '/vip', { vip: false });
    await waitForCommit();
    const output = getOutput()!;
    expect(output.props.text).toBe('Access denied. Please upgrade.');
    expect(output.children.length).toBeGreaterThan(0);
  });

  test('reply() allows through when guard passes', async () => {
    const router = createRouter({
      '/': Home,
      '/vip': {
        component: Premium,
        beforeLoad: ({ session, reply }) => {
          if (!session.vip) return reply('Nope');
        },
      },
    });
    const { getOutput } = renderWithRouter(router, '/vip', { vip: true });
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Premium Content');
  });

  test('JSX element guard renders the element', async () => {
    const router = createRouter({
      '/': Home,
      '/locked': {
        component: Premium,
        beforeLoad: ({ session }) => {
          if (!session.auth) return React.createElement('tg-message', { text: 'Custom Login UI' });
        },
      },
    });
    const { getOutput } = renderWithRouter(router, '/locked', {});
    await waitForCommit();
    expect(getOutput()!.props.text).toBe('Custom Login UI');
  });
});
