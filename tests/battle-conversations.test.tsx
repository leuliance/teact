import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import {
  useConversation, useForm, Conversation, Form, kvSessionStore,
  type FormResult, type SchemaLike,
} from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot } from '../packages/testing/src';

const GROUP = '-100777';
const ALICE = '1';
const BOB = '2';

function sharedStore() {
  const data = new Map<string, string>();
  return kvSessionStore({ get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } });
}

/** Tiny Zod-like schema. */
function minLen(n: number, msg?: string): SchemaLike {
  return {
    safeParse: (v: unknown) => (typeof v === 'string' && v.length >= n
      ? { success: true }
      : { success: false, error: { issues: msg === undefined ? [] : [{ message: msg }, { message: 'second issue' }] } }),
  };
}

function ProfileForm({ onDone }: { onDone?: (d: Record<string, string>) => void }) {
  const form = useForm({
    name: { prompt: 'Name?', validate: (v) => (v.trim().length >= 2 ? true : 'Too short') },
    age: { prompt: (d) => `Age, ${d.name}?`, validate: (v) => (/^\d+$/.test(v) ? true : 'Digits only') },
  });
  return form.render(() => {
    onDone?.(form.data);
    return <Message text={`done:${form.data.name}:${form.data.age}`} />;
  });
}

describe('useForm — validation', () => {
  test('validation failure shows error, then success advances and clears it', async () => {
    const t = await createTestBot({ component: ProfileForm });
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('Name?');
    await t.send('A');
    expect(t.lastMessage?.text).toContain('Too short');
    expect(t.lastMessage?.text).toContain('Name?');
    await t.send('Ada');
    expect(t.lastMessage?.text).toBe('Age, Ada?');
    await t.send('30');
    expect(t.lastMessage?.text).toBe('done:Ada:30');
    await t.stop();
  });

  test('repeated validation errors are replaced, not stacked', async () => {
    const t = await createTestBot({ component: ProfileForm });
    await t.send('/start');
    await t.send('Ada');
    await t.send('abc');
    await t.send('x1');
    await t.send('-5');
    const txt = t.lastMessage!.text;
    expect(txt.match(/⚠️/g)?.length).toBe(1);
    expect(txt.match(/Digits only/g)?.length).toBe(1);
    await t.stop();
  });

  test('Zod-like schema: first issue message is shown; empty issues fall back to "Invalid input"', async () => {
    function F() {
      const form = useForm({
        a: { prompt: 'A?', validate: minLen(3, 'At least 3') },
        b: { prompt: 'B?', validate: minLen(3) },
      });
      return form.render(() => <Message text={`ok:${form.data.a}:${form.data.b}`} />);
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('xy');
    expect(t.lastMessage?.text).toContain('At least 3');
    expect(t.lastMessage?.text).not.toContain('second issue');
    await t.send('xyz');
    await t.send('q');
    expect(t.lastMessage?.text).toContain('Invalid input');
    await t.send('qqq');
    expect(t.lastMessage?.text).toBe('ok:xyz:qqq');
    await t.stop();
  });

  test('a validator that returns false (JS habit) rejects WITH a visible error, not silently', async () => {
    function F() {
      const form = useForm({ code: { prompt: 'Code?', validate: ((v: string) => v === 'ok') as any } });
      return form.render(() => <Message text="ok" />);
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('nope');
    expect(t.lastMessage?.text).not.toBe('Code?'); // user must be told why nothing happened
    expect(t.lastMessage?.text).toContain('⚠️');
    await t.stop();
  });

  test('a validator returning an empty-string error still shows a warning', async () => {
    function F() {
      const form = useForm({ code: { prompt: 'Code?', validate: (v) => (v === 'ok' ? true : '') } });
      return form.render(() => <Message text="ok" />);
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('nope');
    expect(t.lastMessage?.text).toContain('⚠️');
    await t.stop();
  });

  test('a throwing validator does not wipe earlier answers', async () => {
    function F() {
      const form = useForm({
        name: { prompt: 'Name?' },
        n: { prompt: 'Number?', validate: (v) => { if (v === 'boom') throw new Error('validator bug'); return true; } },
      });
      return form.render(() => <Message text={`ok:${form.data.name}:${form.data.n}`} />);
    }
    const errors: unknown[] = [];
    const t = await createTestBot({ component: F, onError: (e) => { errors.push(e); } });
    await t.send('/start');
    await t.send('Ada');
    await t.send('boom');
    await t.send('7');
    expect(t.lastMessage?.text).toBe('ok:Ada:7');
    await t.stop();
  });

  test('whitespace-only input is rejected by a trim validator', async () => {
    const t = await createTestBot({ component: ProfileForm });
    await t.send('/start');
    await t.send('     ');
    expect(t.lastMessage?.text).toContain('Too short');
    await t.stop();
  });

  test('empty text (e.g. a sticker/photo with no text) is not accepted as an answer', async () => {
    const t = await createTestBot({ component: ProfileForm });
    await t.send('/start');
    await t.adapter.simulateMessage('1', '1', '');
    expect(t.lastMessage?.text).toBe('Name?');
    await t.send('Ada');
    expect(t.lastMessage?.text).toBe('Age, Ada?');
    await t.stop();
  });
});

describe('useForm — odd input survives verbatim', () => {
  for (const [label, value] of [
    ['5000 chars', 'x'.repeat(5000)],
    ['emoji / ZWJ', '👩‍👩‍👧‍👦 Zoë 🇺🇦'],
    ['HTML-ish', '<b>x</b> & <script>'],
    ['newlines', 'line1\nline2\n\tline3'],
  ] as const) {
    test(`stores ${label} exactly`, async () => {
      let got: Record<string, string> | undefined;
      function F() {
        const form = useForm({ v: { prompt: 'V?' }, w: { prompt: 'W?' } });
        return form.render(() => { got = { ...form.data }; return <Message text="ok" />; });
      }
      const t = await createTestBot({ component: F });
      await t.send('/start');
      await t.send(value);
      expect(t.lastMessage?.text).toBe('W?');
      await t.send('2');
      expect(got).toEqual({ v: value, w: '2' });
      await t.stop();
    });
  }
});

function YesNoForm() {
  const form = useForm({
    q1: { prompt: 'Coffee?', options: [['Yes', 'No']] },
    q2: { prompt: 'Sugar?', options: [['Yes', 'No']] },
    q3: { prompt: 'Size?', options: [['S', 'M', 'L']] },
  });
  return form.render(() => <Message text={`done:${form.data.q1}:${form.data.q2}:${form.data.q3}`} />);
}

describe('useForm — option buttons', () => {
  test('typing text when a button answer is expected shows a hint, buttons still work', async () => {
    const t = await createTestBot({ component: YesNoForm });
    await t.send('/start');
    await t.send('yes please');
    expect(t.lastMessage?.text).toContain('Please pick an option');
    expect(t.lastMessage?.buttons.flat().map((b) => b.text)).toEqual(['Yes', 'No']);
    await t.click('No');
    expect(t.lastMessage?.text).toBe('Sugar?');
    await t.click('Yes');
    await t.click('M');
    expect(t.lastMessage?.text).toBe('done:No:Yes:M');
    await t.stop();
  });

  test('a stale tap on an earlier question\'s button (same label) does not answer the current question', async () => {
    const t = await createTestBot({ component: YesNoForm });
    await t.send('/start');
    const q1 = t.lastMessage!;
    const q1Yes = q1.buttons.flat().find((b) => b.text === 'Yes')!;
    await t.click('Yes'); // q1 = Yes → message edited to "Sugar?"
    expect(t.lastMessage?.text).toBe('Sugar?');
    // Late/old tap of q1's "Yes" (Telegram still reports label "Yes").
    await t.adapter.simulateCallback('1', '1', q1Yes.data!, String(q1.id), { callbackLabel: 'Yes' });
    expect(t.lastMessage?.text).toBe('Sugar?');
    await t.stop();
  });

  test('double-tapping an option answers only that question', async () => {
    const t = await createTestBot({ component: YesNoForm });
    await t.send('/start');
    const q1 = t.lastMessage!;
    const yes = q1.buttons.flat().find((b) => b.text === 'Yes')!;
    await Promise.all([
      t.adapter.simulateCallback('1', '1', yes.data!, String(q1.id), { callbackLabel: 'Yes' }),
      t.adapter.simulateCallback('1', '1', yes.data!, String(q1.id), { callbackLabel: 'Yes' }),
    ]);
    expect(t.lastMessage?.text).toBe('Sugar?');
    await t.stop();
  });

  test('a stale tap with a label not on the current question is ignored', async () => {
    const t = await createTestBot({ component: YesNoForm });
    await t.send('/start');
    await t.click('Yes');
    await t.click('No');
    expect(t.lastMessage?.text).toBe('Size?');
    // old "No" from q2 (data no longer registered; label not on screen)
    await t.adapter.simulateCallback('1', '1', '__ask:bogus:q2:0:1', String(t.lastMessage!.id), { callbackLabel: 'No' });
    expect(t.lastMessage?.text).toBe('Size?');
    await t.stop();
  });

  test('option labels with special chars / long text and a >64-byte field key still work (alias)', async () => {
    const longKey = 'favourite_pokemon_starter_in_the_original_kanto_region_games_please_answer';
    const longLabel = 'Bulbasaur 🌱 "the seed" <grass/poison> & friends — '.repeat(3);
    let got: Record<string, string> | undefined;
    function F() {
      const form = useForm({ [longKey]: { prompt: 'Pick', options: [[longLabel, 'a:b|c/d?e=f']] } });
      return form.render(() => { got = { ...form.data }; return <Message text="ok" />; });
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    for (const b of t.lastMessage!.buttons.flat()) expect(new TextEncoder().encode(b.data!).length).toBeLessThanOrEqual(64);
    await t.click(longLabel);
    expect(got).toEqual({ [longKey]: longLabel });
    await t.send('/start');
    await t.stop();
  });
});

describe('useForm — navigation & lifecycle', () => {
  function NavForm() {
    const form = useForm({
      a: { prompt: 'A?' },
      b: { prompt: 'B?' },
      c: { prompt: 'C?' },
    });
    const el = form.render(() => <Message text={`done:${form.data.a}:${form.data.b}:${form.data.c}`} />);
    return (
      <>
        {el}
        <Message text={`nav back=${form.canGoBack()} complete=${form.complete}`}>
          <InlineKeyboard>
            <Button text="back" onClick={() => form.back()} />
            <Button text="toA" onClick={() => form.goTo('a')} />
            <Button text="toC" onClick={() => form.goTo('c')} />
            <Button text="toX" onClick={() => (form.goTo as (k: string) => void)('nope')} />
            <Button text="reset" onClick={() => form.reset()} />
          </InlineKeyboard>
        </Message>
      </>
    );
  }
  // A fragment of two <Message>s is merged into one Telegram message: split it back.
  const promptText = (t: Awaited<ReturnType<typeof createTestBot>>) => t.lastMessage?.text.split('nav ')[0];
  const navText = (t: Awaited<ReturnType<typeof createTestBot>>) => 'nav ' + t.lastMessage?.text.split('nav ')[1];

  test('back() at the first step is a harmless no-op', async () => {
    const t = await createTestBot({ component: NavForm });
    await t.send('/start');
    expect(navText(t)).toContain('back=false');
    await t.click('back');
    expect(promptText(t)).toBe('A?');
    await t.send('1');
    expect(promptText(t)).toBe('B?');
    await t.stop();
  });

  test('back() re-asks the previous step and keeps later flow intact', async () => {
    const t = await createTestBot({ component: NavForm });
    await t.send('/start');
    await t.send('1');
    await t.click('back');
    expect(promptText(t)).toBe('A?');
    await t.send('one');
    await t.send('2');
    await t.send('3');
    expect(promptText(t)).toBe('done:one:2:3');
    await t.stop();
  });

  test('goTo(earlier) after completion re-asks only that step and completes again', async () => {
    const t = await createTestBot({ component: NavForm });
    await t.send('/start');
    await t.send('1'); await t.send('2'); await t.send('3');
    await t.click('toA');
    expect(promptText(t)).toBe('A?');
    await t.send('uno');
    expect(promptText(t)).toBe('done:uno:2:3');
    await t.stop();
  });

  test('goTo(unknown key) does not crash or lose answers', async () => {
    const t = await createTestBot({ component: NavForm });
    await t.send('/start');
    await t.send('1');
    await t.click('toX');
    expect(promptText(t)).toBe('B?');
    await t.send('2');
    expect(promptText(t)).toBe('C?');
    await t.stop();
  });

  test('goTo(later, unanswered key) jumps to that step', async () => {
    const t = await createTestBot({ component: NavForm });
    await t.send('/start');
    await t.click('toC');
    expect(promptText(t)).toBe('C?');
    await t.stop();
  });

  test('reset() mid-flow restarts at the first question with empty data', async () => {
    const t = await createTestBot({ component: NavForm });
    await t.send('/start');
    await t.send('1'); await t.send('2');
    await t.click('reset');
    expect(promptText(t)).toBe('A?');
    await t.send('x'); await t.send('y'); await t.send('z');
    expect(promptText(t)).toBe('done:x:y:z');
    await t.stop();
  });

  test('a registered /command mid-form restarts cleanly', async () => {
    const t = await createTestBot({ component: ProfileForm, commands: { start: { description: 'start' } } });
    await t.send('/start');
    await t.send('Ada');
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('Name?');
    await t.stop();
  });

  test('an unregistered /command typed mid-form is NOT captured as an answer', async () => {
    const t = await createTestBot({ component: ProfileForm, commands: { start: { description: 'start' } } });
    await t.send('/start');
    await t.send('/help');
    expect(t.lastMessage?.text).not.toContain('/help');
    expect(t.lastMessage?.text).not.toBe('Age, /help?');
    await t.stop();
  });

  test('messages after completion leave the result unchanged', async () => {
    let completions = 0;
    const t = await createTestBot({ component: () => <ProfileForm onDone={() => { completions++; }} /> });
    await t.send('/start');
    await t.send('Ada'); await t.send('30');
    await t.send('hello?'); await t.send('42');
    expect(t.lastMessage?.text).toBe('done:Ada:30');
    expect(completions).toBeGreaterThan(0);
    await t.stop();
  });

  test('very fast consecutive answers are all recorded in order', async () => {
    let got: Record<string, string> | undefined;
    function F() {
      const form = useForm({ a: { prompt: 'A?' }, b: { prompt: 'B?' }, c: { prompt: 'C?' } });
      return form.render(() => { got = { ...form.data }; return <Message text="ok" />; });
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await Promise.all([t.send('1'), t.send('2'), t.send('3')]);
    expect(got).toEqual({ a: '1', b: '2', c: '3' });
    await t.stop();
  });

  test('an edited_message is not treated as an answer', async () => {
    const t = await createTestBot({ component: ProfileForm });
    await t.send('/start');
    await t.send('Ad');
    await t.event('edited_message', { edited_message: { message_id: 101, chat: { id: 1 }, text: 'Ada Lovelace' } });
    expect(t.lastMessage?.text).toBe('Age, Ad?');
    await t.stop();
  });

  test('useForm with zero fields is immediately complete', async () => {
    function F() {
      const form = useForm({});
      return form.render(() => <Message text={`complete=${form.complete}`} />);
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('complete=true');
    await t.stop();
  });

  test('form.render() without a callback returns null when complete', async () => {
    function F() {
      const form = useForm({ a: { prompt: 'A?' } });
      const el = form.render();
      if (!el) return <Message text={`fallback:${form.data.a}`} />;
      return el;
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('z');
    expect(t.lastMessage?.text).toBe('fallback:z');
    await t.stop();
  });
});

describe('multiple forms', () => {
  test('two forms in sequence: the message completing form A is not consumed by form B', async () => {
    function F() {
      const a = useForm({ a: { prompt: 'A?' } });
      const b = useForm({ b: { prompt: 'B?' } });
      if (!a.complete) return a.render();
      return b.render(() => <Message text={`done:${a.data.a}:${b.data.b}`} />);
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('first');
    expect(t.lastMessage?.text).toBe('B?');
    await t.send('second');
    expect(t.lastMessage?.text).toBe('done:first:second');
    await t.stop();
  });

  test('two forms visible at once: one text message answers only ONE of them', async () => {
    let snap: string[] = [];
    function F() {
      const a = useForm({ a: { prompt: 'A?' } });
      const b = useForm({ b: { prompt: 'B?' } });
      snap = [a.data.a ?? '-', b.data.b ?? '-'];
      return <>{a.render(() => <Message text="A done" />)}{b.render(() => <Message text="B done" />)}</>;
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('hello');
    expect(snap.filter((x) => x === 'hello')).toHaveLength(1);
    await t.stop();
  });
});

describe('group chats', () => {
  test('in a group, another member\'s text does not answer the user\'s form', async () => {
    const t = await createTestBot({ component: ProfileForm, chatId: GROUP, userId: ALICE });
    await t.send('/start');
    await t.adapter.simulateMessage(GROUP, BOB, 'lol random chatter');
    expect(t.lastMessage?.text).toBe('Name?');
    await t.stop();
  });

  test('in a group, another member cannot tap the user\'s form option buttons', async () => {
    const t = await createTestBot({ component: YesNoForm, chatId: GROUP, userId: ALICE });
    await t.send('/start');
    const q1 = t.lastMessage!;
    const no = q1.buttons.flat().find((b) => b.text === 'No')!;
    await t.adapter.simulateCallback(GROUP, BOB, no.data!, String(q1.id), { callbackLabel: 'No' });
    expect(t.lastMessage?.text).toBe('Coffee?');
    await t.stop();
  });

  test('callback data from one chat does not affect another chat\'s form', async () => {
    const t = await createTestBot({ component: YesNoForm });
    await t.send('/start');
    await t.adapter.simulateMessage('2', '2', '/start');
    await t.click('Yes');
    expect(t.lastMessage?.text).toBe('Sugar?');
    const chat2 = t.adapter.sent.filter((s) => String(s.chatId) === '2');
    const chat2Edits = t.adapter.edited.filter((e) => String(e.chatId) === '2');
    expect(chat2Edits).toHaveLength(0);
    expect(chat2.at(-1)?.output.props.text).toBe('Coffee?');
    await t.stop();
  });
});

describe('restart', () => {
  test('restart mid-form: the answer sent to the new instance is not silently swallowed', async () => {
    // Durable progress across restarts is a design limitation (answers live in useState),
    // but at minimum the user's message must not vanish without effect.
    const store = sharedStore();
    const a = await createTestBot({ component: ProfileForm, session: { store } });
    await a.send('/start');
    await a.send('Ada');
    expect(a.lastMessage?.text).toBe('Age, Ada?');
    await a.stop();
    const b = await createTestBot({ component: ProfileForm, session: { store } });
    await b.send('30');
    // Either progress was restored ("done:Ada:30") or "30" was at least treated as an
    // answer to Q1. Re-asking "Name?" as if nothing was received is the worst outcome.
    expect(b.lastMessage?.text).not.toBe('Name?');
    await b.stop();
  });

  test('restart mid-form with a durable session store preserves progress', async () => {
    const store = sharedStore();
    const a = await createTestBot({ component: ProfileForm, session: { store } });
    await a.send('/start');
    await a.send('Ada');
    await a.stop();
    const b = await createTestBot({ component: ProfileForm, session: { store } });
    await b.send('30');
    expect(b.lastMessage?.text).toBe('done:Ada:30');
    await b.stop();
  });

  test('a command after a restart starts the form over instead of restoring it', async () => {
    const store = sharedStore();
    const a = await createTestBot({ component: ProfileForm, session: { store } });
    await a.send('/start');
    await a.send('Ada');
    await a.stop();
    const b = await createTestBot({ component: ProfileForm, session: { store }, commands: { start: { description: 's' } } });
    await b.send('/start');
    expect(b.lastMessage?.text).toBe('Name?');
    await b.send('Bob');
    expect(b.lastMessage?.text).toBe('Age, Bob?');
    await b.stop();
  });
});

describe('useConversation — imperative mode', () => {
  test('has/get/set/clear/prompt/ask(text,value)/waitFor all work together', async () => {
    let conv!: ReturnType<typeof useConversation>;
    function F() {
      conv = useConversation({ validate: (k, v) => (k === 'age' && !/^\d+$/.test(v) ? 'number pls' : true) });
      if (!conv.has('name')) return conv.prompt('name', 'Name?');
      if (!conv.has('age')) return <Message text={`${conv.lastError ? 'ERR ' : ''}Age for ${conv.get('name')}?`}>{(conv.waitFor('age'), null)}</Message>;
      if (!conv.has('color')) return conv.ask('color', 'Color?', [[{ text: '🔴 Red', value: 'red' }, 'Blue']]);
      return (
        <Message text={`done:${conv.get('name')}:${conv.get('age')}:${conv.get('color')}`}>
          <InlineKeyboard>
            <Button text="recolor" onClick={() => conv.clear('color')} />
            <Button text="setname" onClick={() => conv.set('name', 'Bob')} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('Name?');
    await t.send('Ada');
    expect(t.lastMessage?.text).toBe('Age for Ada?');
    await t.send('old');
    expect(t.lastMessage?.text).toBe('ERR Age for Ada?');
    await t.send('36');
    expect(t.lastMessage?.text).toBe('Color?');
    await t.click('🔴 Red');
    expect(t.lastMessage?.text).toBe('done:Ada:36:red');
    await t.click('recolor');
    expect(t.lastMessage?.text).toBe('Color?');
    await t.click('Blue');
    await t.click('setname');
    expect(t.lastMessage?.text).toBe('done:Bob:36:Blue');
    expect(conv.complete).toBe(false); // documented: always false in imperative mode
    await t.stop();
  });

  test('isWaiting is true while a prompt is on screen and false once answered', async () => {
    const seen: boolean[] = [];
    function F() {
      const conv = useConversation();
      const el = conv.has('x') ? <Message text={`got ${conv.get('x')}`} /> : conv.prompt('x', 'X?');
      seen.push(conv.isWaiting);
      return <>{el}<Message text={`waiting=${conv.isWaiting}`} /></>;
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('X?waiting=true');
    await t.send('1');
    expect(t.lastMessage?.text).toBe('got 1waiting=false');
    await t.stop();
  });
});

describe('useConversation — steps-config mode', () => {
  function Steps() {
    const conv = useConversation({
      name: { prompt: 'Name?', validate: minLen(2, 'Too short') },
      plan: { ask: 'Plan?', options: [[{ text: 'Free', value: 'free' }, { text: 'Pro ⭐', value: 'pro' }]] },
      confirm: {
        render: (done, actions) => (
          <Message text={`Confirm? canGoBack=${actions.canGoBack()}`}>
            <InlineKeyboard>
              <Button text="ok" onClick={() => done('yes')} />
              <Button text="back" onClick={() => actions.back()} />
              <Button text="rename" onClick={() => actions.goTo('name')} />
            </InlineKeyboard>
          </Message>
        ),
      },
    });
    return conv.render(() => <Message text={`done:${conv.data.name}:${conv.data.plan}:${conv.data.confirm}:complete=${conv.complete}:step=${conv.step}:current=${conv.current}`} />);
  }

  test('prompt → ask(value) → render step → complete, with accurate flags', async () => {
    const t = await createTestBot({ component: Steps });
    await t.send('/start');
    await t.send('A');
    expect(t.lastMessage?.text).toContain('Too short');
    await t.send('Ada');
    expect(t.lastMessage?.text).toBe('Plan?');
    await t.send('pro');
    expect(t.lastMessage?.text).toContain('Please pick an option');
    await t.click('Pro ⭐');
    expect(t.lastMessage?.text).toBe('Confirm? canGoBack=true');
    await t.click('ok');
    expect(t.lastMessage?.text).toBe('done:Ada:pro:yes:complete=true:step=3:current=null');
    await t.stop();
  });

  test('render-step back() returns to the ask step; goTo(name) re-asks only the name', async () => {
    const t = await createTestBot({ component: Steps });
    await t.send('/start');
    await t.send('Ada');
    await t.click('Free');
    await t.click('back');
    expect(t.lastMessage?.text).toBe('Plan?');
    await t.click('Pro ⭐');
    await t.click('rename');
    expect(t.lastMessage?.text).toBe('Name?');
    await t.send('Grace');
    expect(t.lastMessage?.text).toBe('Confirm? canGoBack=true');
    await t.click('ok');
    expect(t.lastMessage?.text).toContain('done:Grace:pro:yes');
    await t.stop();
  });
});

describe('<Conversation> / <Form> compound components', () => {
  test('<Conversation> self-contained with Prompt/Ask/Complete(fn)', async () => {
    function C() {
      return (
        <Conversation>
          <Conversation.Prompt name="name" text="Name?" validate={(v) => (v.length > 1 ? true : 'short')} />
          <Conversation.Ask name="color" text="Color?" options={[['Red', 'Blue']]} />
          <Conversation.Complete>{(c) => <Message text={`${c.data.name}/${c.data.color}`} />}</Conversation.Complete>
        </Conversation>
      );
    }
    const t = await createTestBot({ component: C });
    await t.send('/start');
    await t.send('x');
    expect(t.lastMessage?.text).toContain('short');
    await t.send('Ada');
    await t.click('Blue');
    expect(t.lastMessage?.text).toBe('Ada/Blue');
    await t.stop();
  });

  test('<Conversation> picks up a step child that appears conditionally later', async () => {
    function C() {
      const [vip, setVip] = useState(false);
      return (
        <Conversation>
          <Conversation.Step name="plan">
            {(done) => (
              <Message text="Plan?">
                <InlineKeyboard>
                  <Button text="VIP" onClick={() => { setVip(true); done('vip'); }} />
                  <Button text="Free" onClick={() => done('free')} />
                </InlineKeyboard>
              </Message>
            )}
          </Conversation.Step>
          {vip ? <Conversation.Prompt name="company" text="Company?" /> : null}
          <Conversation.Complete>{(c) => <Message text={`done:${c.data.plan}:${c.data.company}`} />}</Conversation.Complete>
        </Conversation>
      );
    }
    const t = await createTestBot({ component: C });
    await t.send('/start');
    await t.click('VIP');
    expect(t.lastMessage?.text).toBe('Company?');
    await t.stop();
  });

  test('<Form> self-contained with Field children and Complete', async () => {
    function F() {
      return (
        <Form>
          <Form.Field name="name" prompt="Name?" />
          <Form.Field name="region" prompt={(d) => `Region for ${d.name}?`} options={[['Kanto', 'Johto']]} />
          <Form.Complete>{(f) => <Message text={`${f.data.name}@${f.data.region}`} />}</Form.Complete>
        </Form>
      );
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('Ash');
    expect(t.lastMessage?.text).toBe('Region for Ash?');
    await t.click('Johto');
    expect(t.lastMessage?.text).toBe('Ash@Johto');
    await t.stop();
  });

  test('<Form value={form}> is externally controlled (back/reset from outside work)', async () => {
    let form!: FormResult<'a' | 'b'>;
    function F() {
      form = useForm({ a: { prompt: 'A?' }, b: { prompt: 'B?' } });
      return (
        <>
          <Form value={form}>
            <Form.Complete><Message text={`done:${form.data.a}:${form.data.b}`} /></Form.Complete>
          </Form>
          <Message text="ctl"><InlineKeyboard><Button text="back" onClick={() => form.back()} /></InlineKeyboard></Message>
        </>
      );
    }
    const t = await createTestBot({ component: F });
    await t.send('/start');
    await t.send('1');
    await t.click('back');
    expect(t.lastMessage?.text).toBe('A?ctl');
    await t.send('x'); await t.send('y');
    expect(t.lastMessage?.text).toBe('done:x:yctl');
    expect(form.complete).toBe(true);
    await t.stop();
  });

  test('<Conversation value={conv}> renders the external conversation', async () => {
    function C() {
      const conv = useConversation({ q: { prompt: 'Q?' } });
      return (
        <Conversation value={conv}>
          <Conversation.Complete><Message text={`ans:${conv.data.q}`} /></Conversation.Complete>
        </Conversation>
      );
    }
    const t = await createTestBot({ component: C });
    await t.send('/start');
    expect(t.lastMessage?.text).toBe('Q?');
    await t.send('42');
    expect(t.lastMessage?.text).toBe('ans:42');
    await t.stop();
  });
});
