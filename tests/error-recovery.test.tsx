import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

const wait = (ms = 35) => new Promise((r) => setTimeout(r, ms));
const lastText = (a: MockAdapter) =>
  [...a.sent, ...a.edited].sort((x, y) => x.timestamp - y.timestamp).at(-1)?.output.props.text;

describe('error recovery — bot does not get stuck after a render error', () => {
  test('shows error fallback, then recovers on the next update', async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('boom');
      return <Message text="recovered!" />;
    }
    const origError = console.error;
    console.error = () => {}; // silence expected error log
    try {
      const adapter = new MockAdapter();
      const bot = createBot({ component: Flaky, adapter, token: 'test' });
      await bot.start();

      adapter.simulateMessage('1', '1', 'hi');
      await wait();
      expect(lastText(adapter)).toContain('Something went wrong');

      // Next update must NOT stay stuck on the error boundary
      shouldThrow = false;
      adapter.simulateMessage('1', '1', 'again');
      await wait();
      expect(lastText(adapter)).toBe('recovered!');

      await bot.stop();
    } finally {
      console.error = origError;
    }
  });
});
