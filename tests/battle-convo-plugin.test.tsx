/**
 * Battle tests for the imperative conversations plugin (packages/telegram/src/conversations.ts).
 * Every test is named after the EXPECTED correct behavior — a failing test is a bug.
 */
import { describe, test, expect } from 'bun:test';
import React from 'react';
import type { BotContext, Middleware } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot, type TestBot } from '../packages/testing/src';
import {
  conversationsPlugin,
  defineConversation,
  ConversationCancelledError,
  type ConversationsConfig,
  type ConversationHandler,
} from '../packages/telegram/src';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Texts sent via the API (conversation messages), optionally for one chat. */
function sent(t: TestBot, chatId?: string | number): string[] {
  return t.apiCalls
    .filter((c) => c.method === 'sendMessage' && (chatId == null || String(c.params.chat_id) === String(chatId)))
    .map((c) => String(c.params.text));
}
function lastAskButtons(t: TestBot, chatId?: string): { text: string; callback_data: string }[][] {
  const call = [...t.apiCalls].reverse().find((c) =>
    c.method === 'sendMessage' && (c.params.reply_markup as any)?.inline_keyboard &&
    (chatId == null || String(c.params.chat_id) === chatId));
  return (call!.params.reply_markup as any).inline_keyboard;
}

/** Bot with a spy middleware placed AFTER the plugin: anything recorded "reached the app". */
async function make(cfg: ConversationsConfig, component: () => React.ReactElement = () => <Message text="home" />) {
  const reached: string[] = [];
  const spy: Middleware = async (ctx: BotContext) => {
    reached.push(ctx.text ?? ctx.callbackData ?? ctx.updateType ?? '?');
  };
  const t = await createTestBot({ component, middleware: [spy], plugins: [conversationsPlugin(cfg)] });
  return { t, reached };
}

const contactUpdate = (chatId: number, fromId: number, contact: Record<string, unknown>) => ({
  text: undefined,
  raw: { update_id: 9000, message: { message_id: 9000, chat: { id: chatId }, from: { id: fromId }, contact } },
});

// ------------------------------------------------------------------------------------------

describe('prompt / wait / ask basics', () => {
  test('prompt re-asks on validation failure until valid', async () => {
    let result = '';
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      result = await c.prompt('Age?', { validate: (v) => /^\d+$/.test(v) || 'Numbers only' });
      await c.send(`ok ${result}`);
    } } } });
    await t.send('/s');
    await t.send('abc');
    await t.send('x1');
    await t.send('42');
    expect(sent(t)).toEqual(['Age?', '⚠️ Numbers only\n\nAge?', '⚠️ Numbers only\n\nAge?', 'ok 42']);
    expect(result).toBe('42');
    await t.stop();
  });

  test('schema-like validator (safeParse) is honored', async () => {
    const schema = { safeParse: (v: unknown) => (String(v).includes('@') ? { success: true } : { success: false, error: { issues: [{ message: 'Bad email' }] } }) };
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      await c.send(`got ${await c.prompt('Email?', { validate: schema })}`);
    } } } });
    await t.send('/s');
    await t.send('nope');
    await t.send('a@b');
    expect(sent(t)).toEqual(['Email?', '⚠️ Bad email\n\nEmail?', 'got a@b']);
    await t.stop();
  });

  test('wait() sends nothing up-front and only the error on invalid input', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      const v = await c.wait({ validate: (x) => x.length > 2 || 'Too short' });
      await c.send(`v=${v}`);
    } } } });
    await t.send('/s');
    expect(sent(t)).toEqual([]);
    await t.send('ab');
    await t.send('abcd');
    expect(sent(t)).toEqual(['⚠️ Too short', 'v=abcd']);
    await t.stop();
  });

  test('ask() resolves to the option value tapped and removes the buttons', async () => {
    let picked = '';
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      picked = await c.ask('Plan?', [[{ text: 'Free', value: 'free' }, { text: 'Pro', value: 'pro' }]]);
      await c.send(`plan ${picked}`);
    } } } });
    await t.send('/s');
    const kb = lastAskButtons(t);
    expect(kb[0][1].callback_data.startsWith('__cq:')).toBe(true);
    await t.adapter.simulateCallback('1', '1', kb[0][1].callback_data, '1');
    expect(picked).toBe('pro');
    expect(t.apiCalls.some((c) => c.method === 'editMessageReplyMarkup')).toBe(true);
    expect(sent(t).at(-1)).toBe('plan pro');
    expect(reached).toEqual([]);
    await t.stop();
  });

  test('tapping the same ask() button twice answers only once (second tap swallowed, never reaches the app)', async () => {
    const answers: string[] = [];
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      answers.push(await c.ask('A?', [['x', 'y']]));
      answers.push(await c.prompt('Name?'));
      await c.send('done');
    } } } });
    await t.send('/s');
    const data = lastAskButtons(t)[0][0].callback_data;
    await t.adapter.simulateCallback('1', '1', data, '1');
    await t.adapter.simulateCallback('1', '1', data, '1');
    expect(answers).toEqual(['x']);
    expect(reached).toEqual([]);
    await t.send('Bob');
    expect(answers).toEqual(['x', 'Bob']);
    await t.stop();
  });

  test("tapping an OLD ask()'s button after a new ask() is ignored", async () => {
    const answers: string[] = [];
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      answers.push(await c.ask('Q1', [['a', 'b']]));
      answers.push(await c.ask('Q2', [['c', 'd']]));
    } } } });
    await t.send('/s');
    const old = lastAskButtons(t)[0][1].callback_data;
    await t.adapter.simulateCallback('1', '1', old, '1');
    const q2 = lastAskButtons(t)[0][0].callback_data;
    await t.adapter.simulateCallback('1', '1', old, '1'); // stale
    expect(answers).toEqual(['b']);
    await t.adapter.simulateCallback('1', '1', q2, '2');
    expect(answers).toEqual(['b', 'c']);
    await t.stop();
  });

  test('typing text during ask() does not answer it (and is not handed to the app)', async () => {
    const answers: string[] = [];
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      answers.push(await c.ask('Pick', [['one']]));
    } } } });
    await t.send('/s');
    await t.send('one');
    expect(answers).toEqual([]);
    expect(reached).toEqual([]);
    await t.adapter.simulateCallback('1', '1', lastAskButtons(t)[0][0].callback_data, '1');
    expect(answers).toEqual(['one']);
    await t.stop();
  });

  test('a leftover ask() button tapped AFTER the conversation ended is swallowed, not passed on to app middleware/router', async () => {
    const { t, reached } = await make({ timeoutMs: 40, conversations: { s: { command: 's', handler: async (c) => {
      await c.ask('Pick', [['one']]);
    } } } });
    await t.send('/s');
    const data = lastAskButtons(t)[0][0].callback_data;
    await sleep(80); // conversation times out while the buttons are still on screen
    const renderedBefore = t.adapter.sent.length;
    await t.adapter.simulateCallback('1', '1', data, '1');
    // A stale __cq: tap must not fall through to the React tree and pop up the app's UI.
    expect(t.adapter.sent.length).toBe(renderedBefore); // (passes: nothing visible is sent)
    expect(reached).not.toContain(data);
    await t.stop();
  });

  test('waitFor custom filter receives the matching ctx', async () => {
    let got: BotContext | undefined;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      got = await c.waitFor((ctx) => ctx.text === 'magic');
      await c.send('found');
    } } } });
    await t.send('/s');
    await t.send('nope');
    expect(got).toBeUndefined();
    await t.send('magic');
    expect(got?.text).toBe('magic');
    expect(sent(t)).toEqual(['found']);
    await t.stop();
  });

  test('a very long conversation (50 prompts) completes and cleans up', async () => {
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      let sum = 0;
      for (let i = 0; i < 50; i++) sum += Number(await c.prompt(`n${i}?`));
      await c.send(`sum ${sum}`);
    } } } });
    await t.send('/s');
    for (let i = 0; i < 50; i++) await t.send(String(i));
    expect(sent(t).at(-1)).toBe(`sum ${(49 * 50) / 2}`);
    await t.send('after');
    expect(reached).toEqual(['after']);
    await t.stop();
  });
});

// ------------------------------------------------------------------------------------------

describe('cancellation, replacement, cleanup', () => {
  test('/cancel mid-conversation rejects with ConversationCancelledError, cleans up and reaches the app', async () => {
    let caught: unknown;
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      try { await c.prompt('Name?'); } catch (e) { caught = e; throw e; }
    } } } });
    await t.send('/s');
    await t.send('/cancel');
    await sleep(5);
    expect(caught).toBeInstanceOf(ConversationCancelledError);
    expect(reached).toEqual(['/cancel']);
    await t.send('hello');
    expect(reached).toEqual(['/cancel', 'hello']);
    // No error message for a cancellation.
    expect(sent(t)).toEqual(['Name?']);
    await t.stop();
  });

  test('/start mid-conversation cancels it and is handled by the app', async () => {
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => { await c.prompt('Name?'); } } } });
    await t.send('/s');
    const msg = await t.send('/start');
    expect(reached).toEqual(['/start']);
    expect(msg?.text).toBe('home');
    await t.stop();
  });

  test('cancelOnCommand:false lets a command answer nothing and keeps the conversation alive', async () => {
    const { t, reached } = await make({ cancelOnCommand: false, conversations: { s: { command: 's', handler: async (c) => {
      await c.send(`got ${await c.prompt('Name?')}`);
    } } } });
    await t.send('/s');
    await t.send('/help');
    await t.send('Ann');
    expect(sent(t)).toEqual(['Name?', 'got Ann']);
    expect(reached).toEqual([]);
    await t.stop();
  });

  test('starting B while A is active (exitActive default) cancels A, B gets the answers', async () => {
    let aErr: unknown;
    const { t } = await make({ conversations: {
      a: { command: 'a', handler: async (c) => { try { await c.prompt('A?'); } catch (e) { aErr = e; throw e; } } },
      b: { command: 'b', handler: async (c) => { await c.send(`B got ${await c.prompt('B?')}`); } },
    } });
    await t.send('/a');
    await t.send('/b');
    await t.send('x');
    expect(aErr).toBeInstanceOf(ConversationCancelledError);
    expect(sent(t)).toEqual(['A?', 'B?', 'B got x']);
    await t.stop();
  });

  test('exitActive:false keeps A, B start is refused', async () => {
    const { t } = await make({ exitActive: false, conversations: {
      a: { command: 'a', handler: async (c) => { await c.send(`A got ${await c.prompt('A?')}`); } },
      b: { command: 'b', handler: async (c) => { await c.prompt('B?'); } },
    } });
    await t.send('/a');
    await t.send('/b');
    await t.send('x');
    expect(sent(t)).toEqual(['A?', 'A got x']);
    await t.stop();
  });

  test('double tap on the start button leaves exactly ONE live conversation; the answer is consumed once', async () => {
    let runs = 0; let completions = 0; let cancels = 0;
    function App() {
      return <Message text="home"><InlineKeyboard><Button text="Go" conversation="go" /></InlineKeyboard></Message>;
    }
    const { t } = await make({ conversations: { go: async (c) => {
      runs++;
      try { await c.prompt('Name?'); completions++; } catch (e) { if (e instanceof ConversationCancelledError) cancels++; throw e; }
    } } }, App);
    await t.send('hi');
    await Promise.all([t.adapter.simulateCallback('1', '1', '__convo:go', '1'), t.adapter.simulateCallback('1', '1', '__convo:go', '1')]);
    await t.send('Zed');
    await sleep(5);
    expect(runs).toBe(2);
    expect(cancels).toBe(1);
    expect(completions).toBe(1);
    await t.stop();
  });

  test('unknown __convo:name is swallowed: no crash, nothing sent, app not reached', async () => {
    const { t, reached } = await make({ conversations: {} });
    await t.adapter.simulateCallback('1', '1', '__convo:does-not-exist', '1');
    expect(sent(t)).toEqual([]);
    expect(reached).toEqual([]);
    await t.send('hi');
    expect(reached).toEqual(['hi']);
    await t.stop();
  });

  test('handler throwing sends errorMessage and frees the chat', async () => {
    const { t, reached } = await make({ errorMessage: 'Oops', conversations: { s: { command: 's', handler: async (c) => {
      await c.prompt('Name?');
      throw new Error('boom');
    } } } });
    await t.send('/s');
    await t.send('x');
    expect(sent(t)).toEqual(['Name?', 'Oops']);
    await t.send('after');
    expect(reached).toEqual(['after']);
    await t.stop();
  });

  test('errorMessage:false stays silent on errors', async () => {
    const { t } = await make({ errorMessage: false, conversations: { s: { command: 's', handler: async () => { throw new Error('x'); } } } });
    await t.send('/s');
    expect(sent(t)).toEqual([]);
    await t.stop();
  });

  test('a NON-async handler (plain function) does not leave the chat permanently hijacked', async () => {
    const { t, reached } = await make({ conversations: { s: { command: 's',
      // A JS user (or a wrapper) passing a sync function. It returns undefined, not a promise.
      handler: ((c: any) => { void c.send('hello'); }) as unknown as ConversationHandler,
    } } });
    await t.send('/s');
    await t.send('after');
    // Expected: the chat is free again. Actual: `undefined.catch` throws AFTER the session was
    // registered, so the session is never removed and every later message is swallowed forever.
    expect(reached).toEqual(['after']);
    await t.stop();
  });

  test('a handler throwing SYNCHRONOUSLY does not leave the chat permanently hijacked', async () => {
    const { t, reached } = await make({ conversations: { s: { command: 's',
      handler: (() => { throw new Error('sync boom'); }) as unknown as ConversationHandler,
    } } });
    await t.send('/s');
    await t.send('after');
    expect(reached).toEqual(['after']);
    await t.stop();
  });

  test('timeoutMs cancels a waiting conversation (ConversationCancelledError) and frees the chat', async () => {
    let caught: unknown;
    const { t, reached } = await make({ timeoutMs: 30, conversations: { s: { command: 's', handler: async (c) => {
      try { await c.prompt('Name?'); } catch (e) { caught = e; throw e; }
    } } } });
    await t.send('/s');
    await sleep(70);
    expect(caught).toBeInstanceOf(ConversationCancelledError);
    expect(String((caught as Error).message)).toContain('timed out');
    await t.send('late');
    expect(reached).toEqual(['late']);
    await t.stop();
  });

  test('timeout is per wait: an active user is not timed out', async () => {
    const { t } = await make({ timeoutMs: 60, conversations: { s: { command: 's', handler: async (c) => {
      for (let i = 0; i < 4; i++) await c.prompt(`q${i}`);
      await c.send('done');
    } } } });
    await t.send('/s');
    for (let i = 0; i < 4; i++) { await sleep(35); await t.send('a'); }
    expect(sent(t).at(-1)).toBe('done');
    await t.stop();
  });

  test('plugin onStop cancels active conversations', async () => {
    let caught: unknown;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      try { await c.prompt('Name?'); } catch (e) { caught = e; throw e; }
    } } } });
    await t.send('/s');
    await t.stop();
    await sleep(5);
    expect(caught).toBeInstanceOf(ConversationCancelledError);
  });

  test("the app's own inline buttons keep working during a conversation", async () => {
    let clicks = 0;
    function App() {
      return <Message text="home"><InlineKeyboard><Button text="Ping" onClick={() => { clicks++; }} /></InlineKeyboard></Message>;
    }
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => { await c.send(`n=${await c.prompt('Name?')}`); } } } }, App);
    await t.send('hi');
    await t.send('/s');
    await t.click('Ping');
    expect(clicks).toBe(1);
    await t.send('Kim');
    expect(sent(t).at(-1)).toBe('n=Kim');
    await t.stop();
  });

  test('defineConversation (global registry) + <Button conversation> starts it', async () => {
    const name = defineConversation('battle-global-convo', async (c) => { await c.send(`hi ${await c.prompt('Who?')}`); });
    function App() {
      return <Message text="home"><InlineKeyboard><Button text="Go" conversation={name} /></InlineKeyboard></Message>;
    }
    const { t } = await make({ conversations: {} }, App);
    await t.send('hi');
    await t.click('Go');
    await t.send('Max');
    expect(sent(t)).toEqual(['Who?', 'hi Max']);
    await t.stop();
  });
});

// ------------------------------------------------------------------------------------------

describe('isolation: chats, users, topics, bots', () => {
  test('two private chats run concurrently with no cross-talk', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      const a = await c.prompt('First?');
      const b = await c.prompt('Second?');
      await c.send(`${c.chatId}:${a}+${b}`);
    } } } });
    await Promise.all([t.adapter.simulateMessage('10', '10', '/s'), t.adapter.simulateMessage('20', '20', '/s')]);
    await Promise.all([t.adapter.simulateMessage('10', '10', 'x1'), t.adapter.simulateMessage('20', '20', 'y1')]);
    await Promise.all([t.adapter.simulateMessage('20', '20', 'y2'), t.adapter.simulateMessage('10', '10', 'x2')]);
    expect(sent(t, 10).at(-1)).toBe('10:x1+x2');
    expect(sent(t, 20).at(-1)).toBe('20:y1+y2');
    await t.stop();
  });

  test('GROUP: another member\'s message does NOT answer the prompt of the user who started the conversation', async () => {
    let answer = '';
    const { t } = await make({ conversations: { pay: { command: 'pay', handler: async (c) => {
      answer = await c.prompt('Amount to send?');
      await c.send(`sending ${answer}`);
    } } } });
    await t.adapter.simulateMessage('-100', '1', '/pay'); // user 1 starts
    await t.adapter.simulateMessage('-100', '2', '9999'); // user 2 types
    expect(answer).toBe(''); // expected: still waiting for user 1
    await t.adapter.simulateMessage('-100', '1', '5');
    expect(answer).toBe('5');
    await t.stop();
  });

  test('GROUP: another member cannot tap the ask() buttons of someone else\'s conversation', async () => {
    let answer = '';
    const { t } = await make({ conversations: { del: { command: 'del', handler: async (c) => {
      answer = await c.ask('Delete your account?', [['Yes', 'No']]);
    } } } });
    await t.adapter.simulateMessage('-100', '1', '/del');
    const yes = lastAskButtons(t, '-100')[0][0].callback_data;
    await t.adapter.simulateCallback('-100', '2', yes, '1'); // user 2 taps "Yes"
    expect(answer).toBe('');
    await t.stop();
  });

  test('GROUP: another member\'s command / own conversation does not cancel someone else\'s conversation', async () => {
    let aErr: unknown;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      try { await c.send(`A ${await c.prompt('Name?')}`); } catch (e) { aErr = e; throw e; }
    } } } });
    await t.adapter.simulateMessage('-100', '1', '/s');
    await t.adapter.simulateMessage('-100', '2', '/help');
    expect(aErr).toBeUndefined();
    await t.stop();
  });

  test('FORUM: a message in topic 2 does not answer a conversation running in topic 1', async () => {
    let answer = '';
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      answer = await c.prompt('Topic 1 question?');
    } } } });
    await t.adapter.simulateMessage('-100', '1', '/s', { threadId: 1 });
    await t.adapter.simulateMessage('-100', '1', 'meant for topic 2', { threadId: 2 });
    expect(answer).toBe('');
    await t.stop();
  });

  test('GROUP: `/s@other_bot` (a command for ANOTHER bot) does not start our conversation', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => { await c.prompt('Name?'); } } } });
    await t.adapter.simulateMessage('-100', '1', '/s@other_bot', { botUsername: 'teact_bot' });
    expect(sent(t)).toEqual([]);
    await t.stop();
  });

  test.todo('conversation state is in-memory: lost on restart and unusable on serverless/multi-instance (documented design limitation)', () => {});
  test.todo('defineConversation uses a module-global registry shared by every bot in the process (two bots cannot have different "feedback" conversations)', () => {});
});

// ------------------------------------------------------------------------------------------

describe('requestContact / requestLocation', () => {
  test('requestContact returns the sender\'s own contact', async () => {
    let got: any;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      got = await c.requestContact('Share your phone');
    } } } });
    await t.send('/s');
    const kb = (t.apiCalls.at(-1)!.params.reply_markup as any).keyboard;
    expect(kb[0][0].request_contact).toBe(true);
    await t.adapter.simulateMessage('1', '1', '', contactUpdate(1, 1, { phone_number: '+111', first_name: 'Me', user_id: 1 }));
    expect(got).toEqual({ phone_number: '+111', first_name: 'Me', last_name: undefined, user_id: 1 });
    expect((t.apiCalls.at(-1)!.params.reply_markup as any).remove_keyboard).toBe(true);
    await t.stop();
  });

  test('SECURITY: requestContact rejects a contact card that belongs to someone else', async () => {
    let got: any;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      got = await c.requestContact('Verify your phone');
    } } } });
    await t.send('/s');
    // User 1 shares (via the attachment menu) the contact card of user 666.
    await t.adapter.simulateMessage('1', '1', '', contactUpdate(1, 1, { phone_number: '+666', first_name: 'Victim', user_id: 666 }));
    expect(got).toBeUndefined();
    await t.stop();
  });

  test('SECURITY: requestContact rejects a contact card without user_id (typed-in contact, unverifiable)', async () => {
    let got: any;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      got = await c.requestContact('Verify your phone');
    } } } });
    await t.send('/s');
    await t.adapter.simulateMessage('1', '1', '', contactUpdate(1, 1, { phone_number: '+999', first_name: 'Fake' }));
    expect(got).toBeUndefined();
    await t.stop();
  });

  test('requestLocation returns lat/lng and removes the keyboard', async () => {
    let got: any;
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      got = await c.requestLocation('Where?');
    } } } });
    await t.send('/s');
    await t.send('just text'); // ignored
    expect(got).toBeUndefined();
    await t.adapter.simulateMessage('1', '1', '', { text: undefined, raw: { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: 1 }, location: { latitude: 1.5, longitude: 2.5 } } } });
    expect(got).toEqual({ latitude: 1.5, longitude: 2.5 });
    await t.stop();
  });
});

// ------------------------------------------------------------------------------------------

describe('stream()', () => {
  async function* gen(chunks: string[], delay = 0, throwAt = -1) {
    for (let i = 0; i < chunks.length; i++) {
      if (i === throwAt) throw new Error('source failed');
      if (delay) await sleep(delay);
      yield chunks[i];
    }
  }

  test('fast chunks are throttled into one send + few edits, final text complete', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      await c.stream(gen(Array.from({ length: 200 }, (_, i) => `${i} `)), { throttleMs: 1000 });
    } } } });
    await t.send('/s');
    const edits = t.apiCalls.filter((c) => c.method === 'editMessageText');
    expect(sent(t)).toHaveLength(1);
    expect(edits.length).toBeLessThanOrEqual(2);
    const final = edits.at(-1)?.params.text ?? sent(t)[0];
    expect(String(final).trim().endsWith('199')).toBe(true);
    await t.stop();
  });

  test('a source that throws mid-way surfaces as a handler error (errorMessage) and frees the chat', async () => {
    const { t, reached } = await make({ errorMessage: 'Oops', conversations: { s: { command: 's', handler: async (c) => {
      await c.stream(gen(['a', 'b', 'c'], 0, 2), { throttleMs: 0 });
    } } } });
    await t.send('/s');
    expect(sent(t).at(-1)).toBe('Oops');
    await t.send('after');
    expect(reached).toEqual(['after']);
    await t.stop();
  });

  test('an empty source sends nothing (no dangling "…" placeholder)', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => { await c.stream(gen([])); } } } });
    await t.send('/s');
    expect(sent(t)).toEqual([]);
    await t.stop();
  });

  test('more than 4096 chars: no text is silently dropped (continues in a new message)', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      await c.stream(gen(['a'.repeat(3000), 'b'.repeat(3000)]), { throttleMs: 0 });
    } } } });
    await t.send('/s');
    const lastEditPerMessage = new Map<number, string>();
    for (const c of t.apiCalls) {
      if (c.method === 'sendMessage') lastEditPerMessage.set(lastEditPerMessage.size + 1, String(c.params.text));
      if (c.method === 'editMessageText') lastEditPerMessage.set(Number(c.params.message_id), String(c.params.text));
    }
    const total = [...lastEditPerMessage.values()].join('').length;
    expect(total).toBe(6000);
    await t.stop();
  });

  test('/cancel during a long stream() interrupts it promptly', async () => {
    let produced = 0;
    async function* slow() { for (let i = 0; i < 20; i++) { await sleep(25); produced++; yield `${i} `; } }
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => { await c.stream(slow(), { throttleMs: 0 }); } } } });
    const started = t.send('/s');
    await sleep(60);
    const cancelled = t.send('/cancel');
    await Promise.all([started, cancelled]);
    // Expected: cancellation stops the stream after a few chunks. Actual: /cancel queues behind
    // the per-chat lock that the conversation holds until it next waits, so all 20 are produced.
    expect(produced).toBeLessThan(20);
    await t.stop();
  });
});

// ------------------------------------------------------------------------------------------

describe('scheduling / liveness', () => {
  test('an update arriving during a slow handler send is not lost: it answers the next prompt', async () => {
    const { t } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      const a = await c.prompt('A?');
      const b = await c.prompt('B?');
      await c.send(`${a}/${b}`);
    } } } });
    const base = t.adapter.apiHandler;
    t.adapter.apiHandler = (m, p) => (m === 'sendMessage' && p.text === 'B?' ? sleep(80).then(() => base(m, p)) : base(m, p));
    await t.send('/s');
    const p1 = t.send('one');
    await sleep(10);
    const p2 = t.send('two'); // arrives while "B?" is still being sent
    await Promise.all([p1, p2]);
    expect(sent(t).at(-1)).toBe('one/two');
    await t.stop();
  });

  test('a handler stuck in a long non-waiting await does not freeze the whole chat (/start still answered promptly)', async () => {
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      await sleep(600); // e.g. a hung fetch / slow LLM call
      await c.prompt('Name?');
    } } } });
    void t.send('/s');
    await sleep(10);
    const start = Date.now();
    await t.send('/start');
    expect(Date.now() - start).toBeLessThan(300);
    expect(reached).toContain('/start');
    await sleep(650);
    await t.stop();
  });

  test('non-message updates (e.g. poll_answer) are not swallowed by an active conversation', async () => {
    const { t, reached } = await make({ conversations: { s: { command: 's', handler: async (c) => {
      await c.replyWithPoll('Fav?', ['a', 'b']);
      await c.prompt('Name?');
    } } } });
    await t.send('/s');
    await t.event('poll_answer', { poll_answer: { poll_id: 'p', user: { id: 1 }, option_ids: [0] } });
    expect(reached).toEqual(['poll_answer']);
    await t.stop();
  });
});
