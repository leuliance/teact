import { describe, test, expect } from 'bun:test';
import { compose, commandMiddleware } from '../packages/core/src/runtime/middleware';
import type { BotContext, Middleware } from '../packages/core/src';

function createMockCtx(overrides: Partial<BotContext> = {}): BotContext {
  return {
    chatId: '1',
    userId: '1',
    user: { id: '1', platform: 'mock' },
    platform: 'mock',
    text: undefined,
    callbackData: undefined,
    raw: {},
    ...overrides,
  };
}

describe('compose', () => {
  test('executes middleware in order', async () => {
    const order: number[] = [];

    const m1: Middleware = async (_, next) => { order.push(1); await next(); order.push(4); };
    const m2: Middleware = async (_, next) => { order.push(2); await next(); order.push(3); };

    const composed = compose([m1, m2]);
    await composed(createMockCtx(), async () => {});

    expect(order).toEqual([1, 2, 3, 4]);
  });

  test('auto-calls next when middleware does not call it', async () => {
    const order: number[] = [];

    const m1: Middleware = async () => { order.push(1); };
    const m2: Middleware = async () => { order.push(2); };

    const composed = compose([m1, m2]);
    await composed(createMockCtx(), async () => {});

    expect(order).toEqual([1, 2]);
  });
});

describe('commandMiddleware', () => {
  test('routes commands to handlers', async () => {
    let handled = false;
    const commands = new Map([
      ['start', async () => { handled = true; }],
    ]);

    const middleware = commandMiddleware(commands);
    const ctx = createMockCtx({ text: '/start' });

    await middleware(ctx, async () => {});
    expect(handled).toBe(true);
  });

  test('passes args to command handler', async () => {
    let receivedArgs: string[] = [];
    const commands = new Map([
      ['echo', async (_: any, args: string[]) => { receivedArgs = args; }],
    ]);

    const middleware = commandMiddleware(commands);
    const ctx = createMockCtx({ text: '/echo hello world' });

    await middleware(ctx, async () => {});
    expect(receivedArgs).toEqual(['hello', 'world']);
  });

  test('calls next for non-command messages', async () => {
    let nextCalled = false;
    const commands = new Map<string, any>();

    const middleware = commandMiddleware(commands);
    const ctx = createMockCtx({ text: 'just a message' });

    await middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('strips @botname from commands', async () => {
    let handled = false;
    const commands = new Map([
      ['start', async () => { handled = true; }],
    ]);

    const middleware = commandMiddleware(commands);
    const ctx = createMockCtx({ text: '/start@mybot' });

    await middleware(ctx, async () => {});
    expect(handled).toBe(true);
  });
});
