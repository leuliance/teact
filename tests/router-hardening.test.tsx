import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot, createRouter, useParams, redirect } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const lastText = (a: MockAdapter) =>
  a.edited.at(-1)?.output.props.text ?? a.getLastSent()?.output.props.text;

describe('router hardening', () => {
  test('static route wins over a param route at the same depth', async () => {
    const List = () => <Message text="the list" />;
    const Detail = () => {
      const { id } = useParams<'/pokemon/:id'>();
      return <Message text={`detail ${id}`} />;
    };
    // Declared param-first on purpose — precedence must NOT depend on insertion order.
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/pokemon/:id': Detail,
      '/pokemon/list': List,
    });
    const adapter = new MockAdapter();
    const bot = createBot({ router, adapter, token: 't' });
    await bot.start();

    adapter.simulateMessage('1', '1', '/start');
    await wait();
    adapter.simulateCallback('1', '1', '__route:/pokemon/list', '1');
    await wait();
    expect(lastText(adapter)).toBe('the list');

    adapter.simulateCallback('1', '1', '__route:/pokemon/25', '1');
    await wait();
    expect(lastText(adapter)).toBe('detail 25');
    await bot.stop();
  });

  test('a trailing slash still matches', async () => {
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/help': () => <Message text="help page" />,
    });
    const adapter = new MockAdapter();
    const bot = createBot({ router, adapter, token: 't' });
    await bot.start();

    adapter.simulateMessage('1', '1', '/start');
    await wait();
    adapter.simulateCallback('1', '1', '__route:/help/', '1');
    await wait();
    expect(lastText(adapter)).toBe('help page');
    await bot.stop();
  });

  test('a guard-rendered component still receives route params', async () => {
    const Preview = () => {
      const { id } = useParams<'/order/:id'>();
      return <Message text={`preview ${id}`} />;
    };
    const router = createRouter({
      '/': () => <Message text="home" />,
      '/order/:id': {
        component: () => <Message text="full order" />,
        beforeLoad: () => <Preview />, // always show the guard element
      },
    });
    const adapter = new MockAdapter();
    const bot = createBot({ router, adapter, token: 't' });
    await bot.start();

    adapter.simulateMessage('1', '1', '/start');
    await wait();
    adapter.simulateCallback('1', '1', '__route:/order/7', '1');
    await wait();
    expect(lastText(adapter)).toBe('preview 7');
    await bot.stop();
  });

  test('a redirect loop falls through to notFound instead of hanging', async () => {
    const router = createRouter(
      {
        '/': () => <Message text="home" />,
        '/a': { component: () => <Message text="A" />, beforeLoad: () => redirect('/b') },
        '/b': { component: () => <Message text="B" />, beforeLoad: () => redirect('/a') },
      },
      { notFound: () => <Message text="not found" /> },
    );
    const adapter = new MockAdapter();
    const bot = createBot({ router, adapter, token: 't' });
    await bot.start();

    adapter.simulateMessage('1', '1', '/start');
    await wait();
    adapter.simulateCallback('1', '1', '__route:/a', '1');
    await wait();
    expect(lastText(adapter)).toBe('not found');
    await bot.stop();
  });

  test('a guard that throws fails closed (notFound), never leaking the protected page', async () => {
    const router = createRouter(
      {
        '/': () => <Message text="home" />,
        '/secret': {
          component: () => <Message text="TOP SECRET" />,
          beforeLoad: () => { throw new Error('db down'); },
        },
      },
      { notFound: () => <Message text="nope" /> },
    );
    const adapter = new MockAdapter();
    const bot = createBot({ router, adapter, token: 't' });
    await bot.start();

    adapter.simulateMessage('1', '1', '/start');
    await wait();
    adapter.simulateCallback('1', '1', '__route:/secret', '1');
    await wait();
    expect(lastText(adapter)).toBe('nope');
    await bot.stop();
  });
});
