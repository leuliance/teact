import { test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createBot, halt } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { maintenance } from '../packages/plugins/src';

test('a /command halted by middleware keeps the chat UI state', async () => {
  const adapter = new MockAdapter();
  let on = false;
  function C() {
    const [n, setN] = useState(0);
    return <Message text={`n=${n}`}><InlineKeyboard><Button text="+" onClick={() => setN(n + 1)} /></InlineKeyboard></Message>;
  }
  const bot = createBot({ component: C, adapter, token: 't', commands: { start: { description: 's' }, help: { description: 'h', handler: 'help' } },
    plugins: [maintenance({ isEnabled: () => on, message: null })] });
  await bot.start();
  await adapter.simulateMessage('1', '1', 'hi');
  const btn = () => JSON.stringify(adapter.sent.at(-1)).match(/__cb:[^"]+/)![0];
  await adapter.simulateCallback('1', '1', btn(), '1');
  await adapter.simulateCallback('1', '1', btn(), '1');
  const last = () => JSON.stringify((adapter.edited.at(-1) ?? adapter.sent.at(-1))?.output).match(/n=\d+/)![0];
  on = true;
  const sentBefore = adapter.sent.length;
  await adapter.simulateMessage('1', '1', '/help'); // blocked by maintenance
  on = false;
  await adapter.simulateCallback('1', '1', btn(), '1');
  expect(last()).toBe('n=3');
  expect(adapter.sent.length).toBe(1); // still editing the original message
  await bot.stop();
});
