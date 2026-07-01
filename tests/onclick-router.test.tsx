import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createBot, createRouter, useNavigate } from '../packages/core/src';
import { Message, Button, InlineKeyboard } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import type { OutputNode } from '../packages/core/src/renderer';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function findButtons(node: OutputNode): OutputNode[] {
  const out: OutputNode[] = [];
  const walk = (n: OutputNode) => { if (n.type === 'tg-button') out.push(n); n.children.forEach(walk); };
  walk(node);
  return out;
}

function Home() {
  return (
    <Message text="home">
      <InlineKeyboard>
        <Button text="Counter" route="/counter" />
      </InlineKeyboard>
    </Message>
  );
}
function Counter() {
  const [n, setN] = useState(0);
  const navigate = useNavigate();
  return (
    <Message text={`count: ${n}`}>
      <InlineKeyboard>
        <Button text="+1" onClick={() => setN((c) => c + 1)} />
        <Button text="home" onClick={() => navigate('/')} />
      </InlineKeyboard>
    </Message>
  );
}

describe('onClick inside a router (showcase pattern)', () => {
  test('route → onClick increments; then onClick navigate home works', async () => {
    const adapter = new MockAdapter();
    const router = createRouter({ '/': Home, '/counter': Counter });
    const bot = createBot({ router, adapter, token: 'test' });
    await bot.start();

    // /start → Home
    adapter.simulateMessage('1', '1', '/start');
    await wait();

    // click "Counter" (route button)
    adapter.simulateCallback('1', '1', '__route:/counter', '1');
    await wait();
    let text = adapter.edited.at(-1)?.output.props.text ?? adapter.getLastSent()?.output.props.text;
    expect(text).toBe('count: 0');

    // click "+1" (onClick handler)
    const plus = findButtons(
      (adapter.edited.at(-1)?.output ?? adapter.getLastSent()!.output),
    ).find((b) => b.props.callbackData?.startsWith('__cb:'))!;
    adapter.simulateCallback('1', '1', plus.props.callbackData, '1');
    await wait();
    text = adapter.edited.at(-1)?.output.props.text ?? adapter.getLastSent()?.output.props.text;
    expect(text).toBe('count: 1');

    await bot.stop();
  });
});
