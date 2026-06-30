import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { RuntimeContext, type RuntimeContextValue } from '../packages/core/src/runtime/context';
import { useAuthSession } from '../packages/core/src/runtime/auth-session';

function waitForCommit(ms = 15): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createMockRuntime(session: Record<string, any> = {}): RuntimeContextValue {
  return {
    botCtx: {
      chatId: '123',
      text: undefined,
      callbackData: undefined,
      user: { id: '123', firstName: 'Test', isBot: false },
      platform: 'telegram',
    } as any,
    session,
    updateSession: (patch) => Object.assign(session, patch),
    command: null,
  };
}

describe('useAuthSession', () => {
  test('isAuthenticated is false when no tokens exist', async () => {
    let result: any = null;
    function TestComponent() {
      result = useAuthSession();
      return React.createElement('tg-message', { text: `auth: ${result.isAuthenticated}` });
    }

    const runtime = createMockRuntime();
    const root = createRoot(() => {});
    root.render(
      React.createElement(RuntimeContext.Provider, { value: runtime },
        React.createElement(TestComponent),
      ),
    );
    await waitForCommit();

    expect(result.isAuthenticated).toBe(false);
    expect(result.accessToken).toBeNull();
    expect(result.refreshToken).toBeNull();
  });

  test('login stores tokens and marks as authenticated', async () => {
    let result: any = null;
    const session: Record<string, any> = {};

    function TestComponent() {
      result = useAuthSession();
      return React.createElement('tg-message', { text: `auth: ${result.isAuthenticated}` });
    }

    const runtime = createMockRuntime(session);
    const root = createRoot(() => {});
    root.render(
      React.createElement(RuntimeContext.Provider, { value: runtime },
        React.createElement(TestComponent),
      ),
    );
    await waitForCommit();

    result.login({ accessToken: 'tok_abc', refreshToken: 'ref_xyz' });
    expect(session.auth).toEqual({ accessToken: 'tok_abc', refreshToken: 'ref_xyz' });
  });

  test('logout clears auth data', async () => {
    let result: any = null;
    const session: Record<string, any> = {
      auth: { accessToken: 'tok_abc', refreshToken: 'ref_xyz' },
    };

    function TestComponent() {
      result = useAuthSession();
      return React.createElement('tg-message', { text: 'test' });
    }

    const runtime = createMockRuntime(session);
    const root = createRoot(() => {});
    root.render(
      React.createElement(RuntimeContext.Provider, { value: runtime },
        React.createElement(TestComponent),
      ),
    );
    await waitForCommit();

    result.logout();
    expect(session.auth).toBeUndefined();
  });

  test('expired token marks as not authenticated', async () => {
    let result: any = null;
    const session: Record<string, any> = {
      auth: { accessToken: 'tok_abc', expiresAt: Date.now() - 1000 },
    };

    function TestComponent() {
      result = useAuthSession();
      return React.createElement('tg-message', { text: 'test' });
    }

    const runtime = createMockRuntime(session);
    const root = createRoot(() => {});
    root.render(
      React.createElement(RuntimeContext.Provider, { value: runtime },
        React.createElement(TestComponent),
      ),
    );
    await waitForCommit();

    expect(result.isAuthenticated).toBe(false);
    expect(result.accessToken).toBeNull();
  });
});
