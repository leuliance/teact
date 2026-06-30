import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import React from 'react';
import { createBot, useForm, Form } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';

const wait = (ms = 35) => new Promise((r) => setTimeout(r, ms));

let warnings: string[] = [];
let origError: typeof console.error;
beforeEach(() => {
  warnings = [];
  origError = console.error;
  console.error = (...args: any[]) => {
    warnings.push(args.map(String).join(' '));
  };
});
afterEach(() => { console.error = origError; });

function lastText(a: MockAdapter): string | undefined {
  // chronologically latest of sent/edited
  const all = [...a.sent, ...a.edited].sort((x, y) => x.timestamp - y.timestamp);
  return all.at(-1)?.output.props.text;
}

describe('multi-step form through the bot (TrainerProfile scenario)', () => {
  test('advances step-by-step and never setState-during-render', async () => {
    function Profile() {
      const form = useForm({
        name: { prompt: "What's your name?" },
        age: { prompt: 'How old are you?' },
      });
      return React.createElement(
        Form,
        { value: form },
        React.createElement(Form.Complete, null, (f: any) =>
          React.createElement(Message, { text: `done:${f.data.name}:${f.data.age}` }),
        ),
      );
    }

    const adapter = new MockAdapter();
    const bot = createBot({ component: Profile, adapter, token: 'test' });
    await bot.start();

    adapter.simulateMessage('1', '1', '/start');
    await wait();
    expect(lastText(adapter)).toContain("What's your name?");

    adapter.simulateMessage('1', '1', 'Alice');
    await wait();
    expect(lastText(adapter)).toContain('How old are you?');

    adapter.simulateMessage('1', '1', '30');
    await wait();
    expect(lastText(adapter)).toBe('done:Alice:30');

    // The bug we fixed: cross-component setState during render
    const bad = warnings.filter((w) => w.includes('Cannot update a component'));
    expect(bad).toEqual([]);

    await bot.stop();
  });
});
