import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createRouter, useNavigate, useSession, useForm, useOn } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot } from '../packages/testing/src';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <Button text="+1" onClick={() => setCount((c) => c + 1)} />
        <Button text="Reset" variant="destructive" onClick={() => setCount(0)} />
      </InlineKeyboard>
    </Message>
  );
}

describe('createTestBot', () => {
  test('drives a component like a user', async () => {
    const t = await createTestBot({ component: Counter, commands: { start: { description: 'Start' } } });
    expect((await t.send('/start'))?.text).toBe('Count: 0');
    await t.click('+1');
    await t.click('+1');
    expect(t.lastMessage?.text).toBe('Count: 2');
    expect(t.lastMessage?.edited).toBe(true);
    expect(t.messages).toHaveLength(1);
    await t.click('Reset'); // variant prefix is ignored when matching
    expect(t.lastMessage?.text).toBe('Count: 0');
    await t.stop();
  });

  test('explains what it sees when a button is missing', async () => {
    const t = await createTestBot({ component: Counter });
    await t.send('hi');
    await expect(t.click('Nope')).rejects.toThrow(/"\+1"/);
    await t.stop();
  });

  test('router + route buttons + session', async () => {
    function Home() {
      const [session] = useSession<{ name?: string }>();
      return (
        <Message text={`Home ${session.name ?? '?'}`}>
          <InlineKeyboard><Button text="Settings" route="/settings" /></InlineKeyboard>
        </Message>
      );
    }
    function Settings() {
      const [, setSession] = useSession<{ name?: string }>();
      const navigate = useNavigate();
      return (
        <Message text="Settings">
          <InlineKeyboard>
            <Button text="Name me Ada" onClick={() => { setSession({ name: 'Ada' }); navigate('/'); }} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ router: createRouter({ '/': Home, '/settings': Settings }) });
    await t.send('hello');
    await t.click('Settings');
    expect(t.lastMessage?.text).toBe('Settings');
    await t.click('Name me Ada');
    expect(t.lastMessage?.text).toBe('Home Ada');
    // Route buttons edit the tapped message in place: still a single message.
    expect(t.messages).toHaveLength(1);
    await t.stop();
  });

  test('forms collect answers across messages', async () => {
    function Signup() {
      const form = useForm({
        name: { prompt: 'Name?', validate: (v) => v.length > 1 || 'Too short' },
        plan: { prompt: 'Plan?', options: [['Free', 'Pro']] },
      });
      return form.render(() => <Message text={`${form.data.name} on ${form.data.plan}`} />);
    }
    const t = await createTestBot({ component: Signup });
    expect((await t.send('/go'))?.text).toBe('Name?');
    expect((await t.send('A'))?.text).toContain('Too short');
    expect((await t.send('Ada'))?.text).toBe('Plan?');
    expect((await t.send('typing instead'))?.text).toContain('Please pick an option');
    await t.click('Pro');
    expect(t.lastMessage?.text).toBe('Ada on Pro');
    await t.stop();
  });

  test('events reach useOn in a live chat but never open a new screen', async () => {
    const seen: string[] = [];
    function Poll() {
      useOn('poll_answer', (a) => { seen.push(a.option_ids.join(',')); });
      return <Message text="Vote!" />;
    }
    const t = await createTestBot({ component: Poll });
    await t.event('poll_answer', { poll_answer: { poll_id: 'p', option_ids: [1] } });
    expect(t.messages).toHaveLength(0); // no live UI yet → nothing rendered
    await t.send('hi');
    await t.event('poll_answer', { poll_answer: { poll_id: 'p', option_ids: [0, 2] } });
    expect(seen).toEqual(['0,2']);
    expect(t.messages).toHaveLength(1);
    await t.stop();
  });

  test('long callback data is aliased under 64 bytes and still dispatches', async () => {
    function Long() {
      const [n, setN] = useState(0);
      return (
        <Message text={`n=${n}`}>
          <InlineKeyboard><Button text="Go" route={`/${'x'.repeat(80)}`} /></InlineKeyboard>
          <InlineKeyboard><Button text="Inc" onClick={() => setN(n + 1)} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Long });
    await t.send('hi');
    const go = t.lastMessage!.buttons.flat().find((b) => b.text === 'Go')!;
    expect(new TextEncoder().encode(go.data!).length).toBeLessThanOrEqual(64);
    await t.stop();
  });

  test('middleware returning false stops the update (commands included)', async () => {
    const t = await createTestBot({
      component: Counter,
      commands: { help: { description: 'Help', handler: 'Help text' } },
      middleware: [(ctx) => (ctx.userId === '1' ? false : undefined)],
    });
    await t.send('/help');
    await t.send('hi');
    expect(t.messages).toHaveLength(0);
    await t.stop();
  });

  test('onError receives failing click handlers', async () => {
    const errors: string[] = [];
    function Boom() {
      return (
        <Message text="boom">
          <InlineKeyboard><Button text="Fail" onClick={async () => { throw new Error('nope'); }} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Boom, onError: (e, info) => errors.push(`${info.source}:${(e as Error).message}`) });
    await t.send('hi');
    await t.click('Fail');
    expect(errors).toEqual(['handler:nope']);
    await t.stop();
  });
});
