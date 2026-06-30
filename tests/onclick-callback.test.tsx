import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createBot } from '../packages/core/src';
import { Message, Button, InlineKeyboard } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import type { OutputNode } from '../packages/core/src/renderer';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function findButton(node: OutputNode): OutputNode | null {
  if (node.type === 'tg-button') return node;
  for (const c of node.children) {
    const hit = findButton(c);
    if (hit) return hit;
  }
  return null;
}

describe('onClick callbacks fire through the bot', () => {
  test('clicking a Button with onClick runs the handler and re-renders', async () => {
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <Message text={`count: ${n}`}>
          <InlineKeyboard>
            <Button text="+1" onClick={() => setN((c) => c + 1)} />
          </InlineKeyboard>
        </Message>
      );
    }

    const adapter = new MockAdapter();
    const bot = createBot({ component: Counter, adapter, token: 'test' });
    await bot.start();

    adapter.simulateMessage('1', '1', 'hi');
    await wait();

    const first = adapter.getLastSent();
    expect(first?.output.props.text).toBe('count: 0');

    const btn = findButton(first!.output)!;
    const cb = btn.props.callbackData as string;
    expect(cb).toBeTruthy();
    expect(cb.startsWith('__cb:')).toBe(true);

    // Simulate the button press
    adapter.simulateCallback('1', '1', cb, '1');
    await wait();

    // The message should now show count: 1 (via send or edit)
    const lastText =
      adapter.edited.at(-1)?.output.props.text ?? adapter.getLastSent()?.output.props.text;
    expect(lastText).toBe('count: 1');

    await bot.stop();
  });
});
