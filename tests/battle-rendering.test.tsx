/**
 * Battle tests: rendering, UI components and misc runtime features.
 * Tests are named for the EXPECTED correct behavior — a failing test is a bug.
 */
import { describe, test, expect, spyOn } from 'bun:test';
import React, { useState, useEffect } from 'react';
import {
  createBot,
  useStream,
  useQuery,
  useMutation,
  useInterval,
  useChatAction,
  useDeepLink,
  useOn,
  useEventData,
  createI18n,
  useLocale,
  type TelegramEvent,
} from '../packages/core/src';
import {
  Message, InlineKeyboard, Button, Bold, Italic, Code, Link, Mention, Photo, MediaGroup,
  Poll, ReplyKeyboard, ReplyKeyboardRemove, Notification, Pagination, usePagination, Confirm,
} from '../packages/ui/src';
import {
  TelegramAdapter, fetchDriver, serializeOutput, buildSendCall, buildEditCall,
  inlineQueryPlugin, inlineArticle,
} from '../packages/telegram/src';
import { createTestBot } from '../packages/testing/src';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderTree(el: React.ReactElement): Promise<OutputNode> {
  let out: OutputNode | null = null;
  const root = createRoot((t) => { out = t; });
  root.render(el);
  await sleep(10);
  root.unmount();
  return out!;
}

async function payloadOf(el: React.ReactElement) {
  return serializeOutput(await renderTree(el));
}

async function waitFor(pred: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) return;
    await sleep(5);
  }
  throw new Error('waitFor timeout');
}

function silenceWarn() {
  return spyOn(console, 'warn').mockImplementation(() => {});
}

const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

// ---------------------------------------------------------------------------------------
// Fake Telegram Bot API (pattern from telegram-drivers.test.tsx)
// ---------------------------------------------------------------------------------------
const TOKEN = '123:FAKE';
const ME = { id: 999, is_bot: true, first_name: 'Teact', username: 'teact_bot' };
interface Call { method: string; params: any }

function fakeTelegram(fail?: (method: string, params: any) => { code: number; description: string } | null) {
  const calls: Call[] = [];
  let nextMessageId = 500;
  const fetchImpl = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = url.split('/').pop()!.split('?')[0];
    const params = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ method, params });
    const f = fail?.(method, params);
    if (f) {
      return new Response(JSON.stringify({ ok: false, error_code: f.code, description: f.description }), {
        status: f.code, headers: { 'content-type': 'application/json' },
      });
    }
    let result: any = true;
    if (method === 'getMe') result = ME;
    else if (method === 'sendMediaGroup') result = params.media.map(() => ({ message_id: nextMessageId++, date: 0, chat: { id: params.chat_id } }));
    else if (method.startsWith('send')) result = { message_id: nextMessageId++, date: 0, chat: { id: params.chat_id, type: 'private' } };
    else if (method.startsWith('edit')) result = { message_id: params.message_id, date: 0, chat: { id: params.chat_id, type: 'private' } };
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl, of: (m: string) => calls.filter((c) => c.method === m) };
}

let updateId = 1;
const tgUser = { id: 42, is_bot: false, first_name: 'Ada' };
const tgChat = { id: 42, type: 'private' as const, first_name: 'Ada' };
const textUpdate = (text: string) => ({
  update_id: updateId++,
  message: { message_id: updateId + 1000, date: 0, chat: tgChat, from: tgUser, text },
});
const callbackUpdate = (data: string, messageId: number) => ({
  update_id: updateId++,
  callback_query: {
    id: `q${updateId}`, from: tgUser, chat_instance: 'ci', data,
    message: { message_id: messageId, date: 0, chat: tgChat, from: ME, text: 'x' },
  },
});
const post = (body: unknown) =>
  new Request('https://bot.example/webhook', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

function tgBot(component: React.ComponentType<any>, extra: Record<string, unknown> = {}, fail?: Parameters<typeof fakeTelegram>[0]) {
  const tg = fakeTelegram(fail);
  const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: tg.fetch, maxRetries: 0 }) });
  const bot = createBot({ adapter, component, ...extra } as any);
  const hit = (u: unknown) => bot.fetch(post(u), { token: TOKEN });
  return { tg, adapter, bot, hit };
}

// =======================================================================================
// 1. HTML escaping / injection
// =======================================================================================
describe('serialize: HTML escaping & injection', () => {
  test('user text inside <Bold> is escaped (no tag injection)', async () => {
    const evil = '</b><a href="tg://x">pwn</a>&amp;';
    const p = await payloadOf(<Message>Hi <Bold>{evil}</Bold></Message>);
    expect(p.parseMode).toBe('HTML');
    expect(p.text).toBe('Hi <b>&lt;/b&gt;&lt;a href="tg://x"&gt;pwn&lt;/a&gt;&amp;amp;</b>');
  });

  test('Message text prop with < & is escaped once formatting children force HTML', async () => {
    const p = await payloadOf(<Message text="a<b & c>"> <Italic>x</Italic></Message>);
    expect(p.text).toBe('a&lt;b &amp; c&gt; <i>x</i>');
  });

  test('Link href with quotes cannot break out of the attribute', async () => {
    const p = await payloadOf(<Message><Link href={'https://x.y/"><b>boom</b>'}>t</Link></Message>);
    expect(p.text).toBe('<a href="https://x.y/&quot;&gt;&lt;b&gt;boom&lt;/b&gt;">t</a>');
  });

  test('Mention with a hostile non-numeric id is attribute-escaped', async () => {
    const p = await payloadOf(<Message><Mention userId={'1"><i>x'}>u</Mention></Message>);
    expect(p.text).toBe('<a href="tg://user?id=1&quot;&gt;&lt;i&gt;x">u</a>');
  });

  test('Code language attribute is escaped', async () => {
    const p = await payloadOf(<Message><Code language={'js"><b>'}>{'a<b'}</Code></Message>);
    expect(p.text).toBe('<pre><code class="language-js&quot;&gt;&lt;b&gt;">a&lt;b</code></pre>');
  });

  test.todo('Link href="javascript:…" / non-http(s)/tg schemes should be rejected or warned (Telegram refuses them) — currently passed through verbatim', () => {});
  test.todo('Mention with a non-numeric userId should warn (tg://user?id= requires an integer) — currently emitted as-is', () => {});

  test('parseMode="MarkdownV2" + <Bold> child never emits raw HTML tags into a MarkdownV2 message', async () => {
    const p = await payloadOf(<Message parseMode="MarkdownV2" text="*hi*"> <Bold>bold</Bold></Message>);
    // Either the formatting is converted to MarkdownV2 (`*bold*`) or the mode switches to HTML —
    // but '<b>' inside a MarkdownV2 message is shown literally to the user.
    if (p.parseMode === 'MarkdownV2') expect(p.text).not.toContain('<b>');
    else expect(p.parseMode).toBe('HTML');
  });

  test('parseMode="Markdown" on Photo + <Bold> child never emits HTML tags in a Markdown caption', async () => {
    const p = await payloadOf(<Photo src="x" caption="_cap_" parseMode="Markdown"><Bold>b</Bold></Photo>);
    if (p.parseMode === 'Markdown') expect(p.text).not.toContain('<b>');
    else expect(p.parseMode).toBe('HTML');
  });
});

// =======================================================================================
// 2. Truncation
// =======================================================================================
describe('serialize: length limits & truncation', () => {
  test('exactly 4096 visible chars inside <Bold> is NOT truncated and keeps formatting', async () => {
    const p = await payloadOf(<Message><Bold>{'x'.repeat(4096)}</Bold></Message>);
    expect(p.parseMode).toBe('HTML');
    expect(p.text).toBe(`<b>${'x'.repeat(4096)}</b>`);
  });

  test('4096 visible chars that expand under HTML escaping (<) are NOT truncated', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Message><Bold>{'<'.repeat(4096)}</Bold></Message>);
    w.mockRestore();
    expect(p.text).toBe(`<b>${'&lt;'.repeat(4096)}</b>`);
  });

  test('4097 visible chars with <Bold> → truncated to exactly 4096 visible chars, valid markup', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Message><Bold>{'x'.repeat(4097)}</Bold></Message>);
    w.mockRestore();
    expect(p.text!.length).toBe(4096);
    expect(p.text!.endsWith('…')).toBe(true);
    expect(p.parseMode).toBeUndefined();
  });

  test('plain 4097-char text → 4096 chars', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Message text={'y'.repeat(4097)} />);
    w.mockRestore();
    expect(p.text!.length).toBe(4096);
  });

  test('truncation never splits a surrogate pair (emoji at the boundary)', async () => {
    const w = silenceWarn();
    const text = 'a'.repeat(4094) + '😀😀😀';
    const p = await payloadOf(<Message text={text} />);
    w.mockRestore();
    expect(hasLoneSurrogate(p.text!)).toBe(false);
  });

  test('explicit parseMode="HTML" + <Bold> over the limit still yields balanced tags', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Message parseMode="HTML"><Bold>{'x'.repeat(5000)}</Bold></Message>);
    w.mockRestore();
    if (p.parseMode === 'HTML') {
      expect((p.text!.match(/<b>/g) ?? []).length).toBe((p.text!.match(/<\/b>/g) ?? []).length);
    }
  });

  test('explicit parseMode="HTML" with escaped child text over the limit never cuts an entity in half', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Message parseMode="HTML">{'&'.repeat(5000)}</Message>);
    w.mockRestore();
    if (p.parseMode === 'HTML') {
      // Every '&' must start a complete entity.
      expect(/&(?!amp;|lt;|gt;|quot;)/.test(p.text!)).toBe(false);
    }
  });

  test('explicit parseMode="HTML": truncation keeps ~4096 VISIBLE chars (not 4096 escaped bytes)', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Message parseMode="HTML">{'&'.repeat(5000)}</Message>);
    w.mockRestore();
    const visible = p.text!.replace(/&amp;/g, '&');
    expect(visible.length).toBeGreaterThan(4000);
  });

  test('Photo caption >1024 with formatting → ≤1024 visible chars', async () => {
    const w = silenceWarn();
    const p = await payloadOf(<Photo src="x" caption={'c'.repeat(1000)}><Bold>{'b'.repeat(100)}</Bold></Photo>);
    w.mockRestore();
    expect(p.text!.length).toBe(1024);
    expect(p.text).not.toContain('<b');
  });

  test('Photo caption exactly 1024 with Bold keeps formatting', async () => {
    const p = await payloadOf(<Photo src="x" caption={'c'.repeat(1000)}><Bold>{'b'.repeat(24)}</Bold></Photo>);
    expect(p.parseMode).toBe('HTML');
    expect(p.text).toBe('c'.repeat(1000) + `<b>${'b'.repeat(24)}</b>`);
  });

  test('MediaGroup item captions >1024 are clamped', async () => {
    const w = silenceWarn();
    const p = await payloadOf(
      <MediaGroup>
        <MediaGroup.Photo src="a" caption={'z'.repeat(2000)} />
        <MediaGroup.Photo src="b" />
      </MediaGroup>,
    );
    w.mockRestore();
    expect(p.mediaGroup![0].caption!.length).toBeLessThanOrEqual(1024);
  });
});

// =======================================================================================
// 3. Empty messages, buttons, keyboards
// =======================================================================================
describe('serialize: empty / buttons / keyboards', () => {
  test('empty <Message/> produces no API call', async () => {
    expect(buildSendCall(await payloadOf(<Message />), 1)).toBeNull();
  });

  test('whitespace-only text produces no API call', async () => {
    expect(buildSendCall(await payloadOf(<Message text={'  \n '} />), 1)).toBeNull();
  });

  test('Message with only buttons sends nothing but warns', async () => {
    const tg = fakeTelegram();
    const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: tg.fetch }) });
    await adapter.connect({ token: TOKEN });
    const w = silenceWarn();
    const tree = await renderTree(<Message><InlineKeyboard><Button text="a" onClick="a" /></InlineKeyboard></Message>);
    expect(await adapter.send(1, tree)).toBeUndefined();
    expect(w.mock.calls.some((c) => String(c[0]).includes('no text'))).toBe(true);
    w.mockRestore();
    expect(tg.of('sendMessage').length).toBe(0);
  });

  test('InlineKeyboard columns=0 / negative fall back to one button per row', async () => {
    for (const columns of [0, -3]) {
      const p = await payloadOf(
        <Message text="t"><InlineKeyboard columns={columns}>
          <Button text="A" onClick="a" /><Button text="B" onClick="b" />
        </InlineKeyboard></Message>,
      );
      expect(p.keyboard!.map((r) => r.map((b) => b.text))).toEqual([['A'], ['B']]);
    }
  });

  test('InlineKeyboard columns=2 grids buttons', async () => {
    const p = await payloadOf(
      <Message text="t"><InlineKeyboard columns={2}>
        {['A', 'B', 'C'].map((x) => <Button key={x} text={x} onClick={x} />)}
      </InlineKeyboard></Message>,
    );
    expect(p.keyboard!.map((r) => r.map((b) => b.text))).toEqual([['A', 'B'], ['C']]);
  });

  test('a keyboard with more than 100 buttons (Telegram max) warns', async () => {
    const w = silenceWarn();
    await payloadOf(
      <Message text="t"><InlineKeyboard columns={8}>
        {Array.from({ length: 120 }, (_, i) => <Button key={i} text={`b${i}`} onClick={`d${i}`} />)}
      </InlineKeyboard></Message>,
    );
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(warned).toBe(true);
  });

  test('a button with empty text is dropped (Telegram rejects empty labels)', async () => {
    const p = await payloadOf(
      <Message text="t"><InlineKeyboard><Button text="" onClick="x" /><Button text="ok" onClick="y" /></InlineKeyboard></Message>,
    );
    expect(p.keyboard).toEqual([[{ text: 'ok', callback_data: 'y' }]]);
  });

  test.todo('url button with an invalid URL (e.g. "not a url") should warn — Telegram 400s the whole message', () => {});

  test('reply keyboard → cannot be an edit (must send)', async () => {
    const tree = await renderTree(
      <Message text="pick"><ReplyKeyboard><ReplyKeyboard.Button text="A" /></ReplyKeyboard></Message>,
    );
    const p = serializeOutput(tree);
    expect(buildEditCall(p, { method: 'sendMessage', text: 'x' }, 1, 2)).toBeNull();
    const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: fakeTelegram().fetch }) });
    expect(adapter.canEdit(tree, 1, 2)).toBe(false);
    expect(buildSendCall(p, 1)!.params.reply_markup).toEqual({ keyboard: [[{ text: 'A' }]], resize_keyboard: true });
  });

  test('ReplyKeyboardRemove → remove_keyboard markup, and not editable', async () => {
    const tree = await renderTree(<Message text="bye"><ReplyKeyboardRemove /></Message>);
    const p = serializeOutput(tree);
    expect(buildSendCall(p, 1)!.params.reply_markup).toEqual({ remove_keyboard: true });
    expect(buildEditCall(p, undefined, 1, 2)).toBeNull();
  });

  test('ReplyKeyboard together with an InlineKeyboard warns that inline buttons are dropped', async () => {
    const w = silenceWarn();
    const p = await payloadOf(
      <Message text="t">
        <InlineKeyboard><Button text="i" onClick="i" /></InlineKeyboard>
        <ReplyKeyboard><ReplyKeyboard.Button text="r" /></ReplyKeyboard>
      </Message>,
    );
    buildSendCall(p, 1);
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(warned).toBe(true);
  });
});

// =======================================================================================
// 4. Media groups & polls
// =======================================================================================
describe('serialize: media groups', () => {
  test('1-item group becomes a single sendPhoto and keeps parse_mode + spoiler', async () => {
    const p = await payloadOf(
      <MediaGroup><MediaGroup.Photo src="a" caption="<b>x</b>" parseMode="HTML" hasSpoiler /></MediaGroup>,
    );
    const call = buildSendCall(p, 1)!;
    expect(call.method).toBe('sendPhoto');
    expect(call.params.caption).toBe('<b>x</b>');
    expect(call.params.parse_mode).toBe('HTML');
    expect(call.params.has_spoiler).toBe(true);
  });

  test('2-item group → sendMediaGroup', async () => {
    const p = await payloadOf(
      <MediaGroup><MediaGroup.Photo src="a" /><MediaGroup.Video src="b" /></MediaGroup>,
    );
    const call = buildSendCall(p, 1)!;
    expect(call.method).toBe('sendMediaGroup');
    expect((call.params.media as any[]).map((m) => m.type)).toEqual(['photo', 'video']);
  });

  test('11-item group is clamped to 10 with a warning', async () => {
    const w = silenceWarn();
    const p = await payloadOf(
      <MediaGroup>{Array.from({ length: 11 }, (_, i) => <MediaGroup.Photo key={i} src={`p${i}`} />)}</MediaGroup>,
    );
    const warned = w.mock.calls.length;
    w.mockRestore();
    expect(p.mediaGroup!.length).toBe(10);
    expect(warned).toBeGreaterThan(0);
  });

  test('media group + InlineKeyboard warns that the keyboard cannot be attached', async () => {
    const w = silenceWarn();
    const p = await payloadOf(
      <>
        <MediaGroup><MediaGroup.Photo src="a" /><MediaGroup.Photo src="b" /></MediaGroup>
        <Message text="t"><InlineKeyboard><Button text="k" onClick="k" /></InlineKeyboard></Message>
      </>,
    );
    const call = buildSendCall(p, 1);
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(call!.method).toBe('sendMediaGroup');
    expect(warned).toBe(true);
  });

  test.todo('media group + sibling <Message text>: the text is silently discarded (album wins) — should be sent as a follow-up or warned', () => {});
});

describe('serialize: polls', () => {
  test('poll with 1 option warns', async () => {
    const w = silenceWarn();
    await payloadOf(<Poll question="q" options={['only']} />);
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(warned).toBe(true);
  });

  test('poll with 13 options (over Telegram max) warns', async () => {
    const w = silenceWarn();
    await payloadOf(<Poll question="q" options={Array.from({ length: 13 }, (_, i) => `o${i}`)} />);
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(warned).toBe(true);
  });

  test('quiz without correctOptionId warns', async () => {
    const w = silenceWarn();
    await payloadOf(<Poll question="q" options={['a', 'b']} type="quiz" />);
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(warned).toBe(true);
  });

  test('poll question over 300 chars warns', async () => {
    const w = silenceWarn();
    await payloadOf(<Poll question={'q'.repeat(400)} options={['a', 'b']} />);
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    expect(warned).toBe(true);
  });

  test('poll is never editable', async () => {
    const tree = await renderTree(<Poll question="q" options={['a', 'b']} />);
    const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: fakeTelegram().fetch }) });
    expect(adapter.canEdit(tree, 1, 2)).toBe(false);
  });
});

// =======================================================================================
// 5. Adapter-level: notifications, edit dedupe
// =======================================================================================
describe('adapter: notifications & edit dedupe', () => {
  test('Notification text >200 chars is clamped so answerCallbackQuery does not 400', async () => {
    function C() {
      const [n, setN] = useState(0);
      return (
        <Message text="hi">
          <InlineKeyboard><Button text="go" onClick={() => setN(1)} /></InlineKeyboard>
          {n ? <Notification text={'n'.repeat(300)} /> : null}
        </Message>
      );
    }
    const { tg, hit } = tgBot(C);
    await hit(textUpdate('hi'));
    const sent = tg.of('sendMessage')[0];
    const data = sent.params.reply_markup.inline_keyboard[0][0].callback_data;
    await hit(callbackUpdate(data, 500));
    const ans = tg.of('answerCallbackQuery').at(-1)!;
    expect(ans.params.text).toBeDefined();
    expect(String(ans.params.text).length).toBeLessThanOrEqual(200);
  });

  test('identical re-render → no edit API call; Notification-only change still answers with text', async () => {
    function C() {
      const [n, setN] = useState(0);
      return (
        <Message text="static">
          <InlineKeyboard><Button text="tap" onClick={() => setN((x) => x + 1)} /></InlineKeyboard>
          {n > 0 ? <Notification text={`tapped ${n}`} /> : null}
        </Message>
      );
    }
    const { tg, hit } = tgBot(C);
    await hit(textUpdate('hi'));
    const data = tg.of('sendMessage')[0].params.reply_markup.inline_keyboard[0][0].callback_data;
    await hit(callbackUpdate(data, 500));
    await hit(callbackUpdate(data, 500));
    expect(tg.of('editMessageText').length).toBe(0);
    expect(tg.of('sendMessage').length).toBe(1);
    const answers = tg.of('answerCallbackQuery');
    expect(answers.map((a) => a.params.text)).toEqual(['tapped 1', 'tapped 2']);
  });

  test('text → reply keyboard re-render sends a new message instead of editing', async () => {
    function C() {
      const [n, setN] = useState(0);
      return n === 0 ? (
        <Message text="a"><InlineKeyboard><Button text="x" onClick={() => setN(1)} /></InlineKeyboard></Message>
      ) : (
        <Message text="b"><ReplyKeyboard><ReplyKeyboard.Button text="r" /></ReplyKeyboard></Message>
      );
    }
    const { tg, hit } = tgBot(C);
    await hit(textUpdate('hi'));
    const data = tg.of('sendMessage')[0].params.reply_markup.inline_keyboard[0][0].callback_data;
    await hit(callbackUpdate(data, 500));
    expect(tg.of('editMessageText').length).toBe(0);
    expect(tg.of('sendMessage').length).toBe(2);
    expect(tg.of('sendMessage')[1].params.reply_markup.keyboard).toEqual([[{ text: 'r' }]]);
  });
});

// =======================================================================================
// 6. Pagination / Confirm
// =======================================================================================
describe('Pagination / usePagination / Confirm', () => {
  test('usePagination with 0 items: one empty page, Pagination renders nothing', async () => {
    let pager: any;
    function C() {
      pager = usePagination([] as string[], { pageSize: 5 });
      return (
        <Message text={`items:${pager.items.length}`}>
          <InlineKeyboard><Pagination page={pager.page} pageCount={pager.pageCount} onChange={pager.goTo} /></InlineKeyboard>
        </Message>
      );
    }
    const p = await payloadOf(<C />);
    expect(pager.pageCount).toBe(1);
    expect(pager.hasNext).toBe(false);
    expect(p.keyboard ?? []).toEqual([]);
    expect(buildSendCall(p, 1)!.params.reply_markup).toBeUndefined();
  });

  test('Pagination with page out of range is clamped in its label', async () => {
    const p = await payloadOf(
      <Message text="t"><InlineKeyboard><Pagination page={7} pageCount={5} onChange={() => {}} /></InlineKeyboard></Message>,
    );
    const labels = p.keyboard![0].map((b) => b.text);
    expect(labels).toContain('5 / 5');
  });

  test('usePagination: initialPage out of range is clamped', async () => {
    let pager: any;
    function C() { pager = usePagination([1, 2, 3], { pageSize: 1, initialPage: 99 }); return <Message text="x" />; }
    await renderTree(<C />);
    expect(pager.page).toBe(3);
  });

  test('usePagination: when the list shrinks then grows back, the page stays where the user sees it', async () => {
    let setList!: (l: number[]) => void;
    let pager: any;
    function C() {
      const [list, s] = useState(Array.from({ length: 50 }, (_, i) => i));
      setList = s;
      pager = usePagination(list, { pageSize: 10, initialPage: 5 });
      return <Message text={String(pager.page)} />;
    }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(10);
    expect(pager.page).toBe(5);
    setList(Array.from({ length: 15 }, (_, i) => i));
    await sleep(10);
    expect(pager.page).toBe(2);
    setList(Array.from({ length: 50 }, (_, i) => i));
    await sleep(10);
    // The user was looking at page 2 — it shouldn't silently jump to page 5.
    expect(pager.page).toBe(2);
    root.unmount();
  });

  test('Confirm double tap (stale Yes button) runs onConfirm once', async () => {
    let confirmed = 0;
    function C() {
      const [done, setDone] = useState(false);
      if (done) return <Message text="Deleted" />;
      return <Confirm text="Delete?" destructive onConfirm={() => { confirmed++; setDone(true); }} />;
    }
    const t = await createTestBot({ component: C });
    await t.send('hi');
    const yes = t.lastMessage!.buttons[0][0];
    const msgId = String(t.lastMessage!.id);
    await t.adapter.simulateCallback('1', '1', yes.data!, msgId, { callbackLabel: yes.text });
    await t.adapter.simulateCallback('1', '1', yes.data!, msgId, { callbackLabel: yes.text });
    expect(confirmed).toBe(1);
    expect(t.lastMessage?.text).toBe('Deleted');
    await t.stop();
  });
});

// =======================================================================================
// 7. useStream
// =======================================================================================
function controllable() {
  const queue: string[] = [];
  let waiter: ((r: IteratorResult<string>) => void) | null = null;
  let finished = false;
  let returned = 0;
  let error: unknown = null;
  const it: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() { return it; },
    next() {
      if (error) { const e = error; error = null; return Promise.reject(e); }
      if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
      if (finished) return Promise.resolve({ value: undefined as any, done: true });
      return new Promise((r) => { waiter = r; });
    },
    return() { returned++; finished = true; waiter?.({ value: undefined as any, done: true }); return Promise.resolve({ value: undefined as any, done: true }); },
  };
  return {
    it,
    push(s: string) { if (waiter) { const w = waiter; waiter = null; w({ value: s, done: false }); } else queue.push(s); },
    end() { finished = true; if (waiter) { const w = waiter; waiter = null; w({ value: undefined as any, done: true }); } },
    fail(e: unknown) { if (waiter) { const w = waiter; waiter = null; (w as any)(Promise.reject(e)); } else error = e; },
    get returned() { return returned; },
  };
}

describe('useStream', () => {
  function harness(throttleMs = 0) {
    const h: { s?: ReturnType<typeof useStream> } = {};
    function C() { h.s = useStream({ throttleMs }); return <Message text={h.s.text || '-'} />; }
    const root = createRoot(() => {});
    root.render(<C />);
    return { h, root };
  }

  test('source that throws → error set, isStreaming false, partial text kept', async () => {
    const { h, root } = harness();
    await sleep(5);
    async function* gen() { yield 'part'; throw new Error('boom'); }
    h.s!.stream(gen());
    await waitFor(() => !h.s!.isStreaming && !!h.s!.error);
    expect(h.s!.error!.message).toBe('boom');
    expect(h.s!.text).toBe('part');
    root.unmount();
  });

  test('stop() mid-stream keeps ALL text received so far (even inside the throttle window)', async () => {
    const { h, root } = harness(10_000);
    await sleep(5);
    const src = controllable();
    h.s!.stream(src.it);
    src.push('a');
    await sleep(10);
    src.push('b');
    src.push('c');
    await sleep(10);
    h.s!.stop();
    await sleep(10);
    expect(h.s!.isStreaming).toBe(false);
    expect(src.returned).toBe(1);
    expect(h.s!.text).toBe('abc');
    root.unmount();
  });

  test('unmount mid-stream calls the iterator return() (producer cleanup)', async () => {
    const { h, root } = harness();
    await sleep(5);
    const src = controllable();
    h.s!.stream(src.it);
    src.push('x');
    await sleep(5);
    root.unmount();
    await sleep(5);
    expect(src.returned).toBe(1);
  });

  test('two streams racing: only the latest stream writes text', async () => {
    const { h, root } = harness();
    await sleep(5);
    const a = controllable();
    const b = controllable();
    h.s!.stream(a.it);
    a.push('A1');
    await sleep(5);
    h.s!.stream(b.it);
    a.push('A2');
    b.push('B1');
    await sleep(5);
    b.end();
    await waitFor(() => !h.s!.isStreaming);
    expect(h.s!.text).toBe('B1');
    expect(a.returned).toBe(1);
    root.unmount();
  });

  test('a source whose iterator factory throws surfaces as `error`, not a thrown exception', async () => {
    const { h, root } = harness();
    await sleep(5);
    const bad = { [Symbol.asyncIterator]() { throw new Error('no iterator'); } } as AsyncIterable<string>;
    let threw = false;
    try { h.s!.stream(bad); } catch { threw = true; }
    await sleep(5);
    expect(threw).toBe(false);
    expect(h.s!.error?.message).toBe('no iterator');
    root.unmount();
  });

  test('very long output is truncated to a sendable message', async () => {
    const { h, root } = harness();
    await sleep(5);
    async function* gen() { for (let i = 0; i < 100; i++) yield 'z'.repeat(100); }
    h.s!.stream(gen());
    await waitFor(() => h.s!.text.length === 10_000 && !h.s!.isStreaming);
    root.unmount();
    const w = silenceWarn();
    const p = await payloadOf(<Message text={h.s!.text} />);
    w.mockRestore();
    expect(p.text!.length).toBe(4096);
  });
});

// =======================================================================================
// 8. utility hooks
// =======================================================================================
describe('useInterval / useChatAction / useDeepLink', () => {
  test('useInterval stops after unmount', async () => {
    let ticks = 0;
    function C() { useInterval(() => { ticks++; }, 10); return <Message text="t" />; }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(60);
    root.unmount();
    const at = ticks;
    expect(at).toBeGreaterThan(0);
    await sleep(60);
    expect(ticks).toBe(at);
  });

  test('useChatAction(active) clears its refresh interval on unmount', async () => {
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    const live = new Set<any>();
    (globalThis as any).setInterval = (fn: any, ms: number) => { const id = realSet(fn, ms); if (ms === 4000) live.add(id); return id; };
    (globalThis as any).clearInterval = (id: any) => { live.delete(id); return realClear(id); };
    try {
      function C() { useChatAction('typing', true); return <Message text="working" />; }
      const t = await createTestBot({ component: C });
      await t.send('hi');
      await sleep(10);
      expect(t.apiCalls.filter((c) => c.method === 'sendChatAction').length).toBeGreaterThan(0);
      expect(live.size).toBe(1);
      await t.stop();
      await sleep(20);
      expect(live.size).toBe(0);
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
  });

  test('useDeepLink: valid payload is read from /start', async () => {
    let payload: string | undefined = 'unset';
    function C() { payload = useDeepLink().payload; return <Message text="x" />; }
    const t = await createTestBot({ component: C, commands: { start: { description: 's' } } });
    await t.send('/start ref_42');
    expect(payload).toBe('ref_42');
    await t.stop();
  });

  test('useDeepLink: a hand-typed /start payload that no deep link could produce is rejected', async () => {
    let payload: string | undefined = 'unset';
    function C() { payload = useDeepLink().payload; return <Message text="x" />; }
    const t = await createTestBot({ component: C, commands: { start: { description: 's' } } });
    await t.send('/start ../../admin<script>');
    expect(payload).toBeUndefined();
    await t.stop();
  });

  test('useDeepLink.link() rejects invalid payloads', async () => {
    let dl: any;
    function C() { dl = useDeepLink(); return <Message text="x" />; }
    const { hit } = tgBot(C);
    await hit(textUpdate('hi'));
    expect(dl.link('ok_1')).toBe('https://t.me/teact_bot?start=ok_1');
    expect(() => dl.link('a b')).toThrow();
    expect(() => dl.link('x'.repeat(65))).toThrow();
    expect(() => dl.link('')).toThrow();
  });
});

// =======================================================================================
// 9. i18n
// =======================================================================================
describe('i18n', () => {
  const i18n = createI18n({
    defaultLocale: 'en',
    resources: {
      en: { translation: { hi: 'Hello {{name}}', only_en: 'EN only' } },
      de: { translation: { hi: 'Hallo {{name}}' } },
    },
  });

  test('missing key falls back to the fallback locale, then to the key', async () => {
    let out: string[] = [];
    function C() {
      const { t, setLocale, locale } = useLocale();
      out = [t('only_en'), t('nope.missing')];
      return <Message text={locale}><InlineKeyboard><Button text="de" onClick={() => setLocale('de')} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: C, providers: i18n.Provider });
    await t.send('hi');
    await t.click('de');
    expect(t.lastMessage?.text).toBe('de');
    expect(out).toEqual(['EN only', 'nope.missing']);
    await t.stop();
  });

  test('HTML in interpolated values is escaped when rendered inside <Bold>', async () => {
    function C() {
      const { t } = useLocale();
      return <Message><Bold>{t('hi', { name: '<a href="x">evil</a>&' })}</Bold></Message>;
    }
    const t = await createTestBot({ component: C, providers: i18n.Provider });
    await t.send('hi');
    const p = serializeOutput(t.lastMessage!.output);
    expect(p.text).toBe('<b>Hello &lt;a href="x"&gt;evil&lt;/a&gt;&amp;</b>');
    await t.stop();
  });

  test('unknown locale stored in the session falls back to default; setLocale(invalid) is a no-op', async () => {
    function C() {
      const { t, setLocale, locale } = useLocale();
      return <Message text={`${locale}:${t('hi', { name: 'x' })}`}><InlineKeyboard><Button text="bad" onClick={() => setLocale('xx')} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: C, providers: i18n.Provider });
    await t.bot._sessionStore.set('mock:1', { locale: 'klingon' } as any);
    const w = silenceWarn();
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('en:Hello x');
    await t.click('bad');
    w.mockRestore();
    expect(t.lastMessage?.text).toBe('en:Hello x');
    await t.stop();
  });

  test('two chats can hold different locales concurrently', async () => {
    function C() {
      const { t, setLocale } = useLocale();
      return <Message text={t('hi', { name: '' }).trim()}><InlineKeyboard><Button text="de" onClick={() => setLocale('de')} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: C, providers: i18n.Provider });
    await t.send('hi');
    await t.click('de');
    await t.adapter.simulateMessage('2', '2', 'hi');
    const chat2 = t.adapter.sent.filter((s) => String(s.chatId) === '2').at(-1)!;
    expect(serializeOutput(chat2.output).text).toBe('Hello');
    await t.send('again');
    expect(t.lastMessage?.text).toBe('Hallo');
    await t.stop();
  });
});

// =======================================================================================
// 10. useQuery / useMutation
// =======================================================================================
let qk = 0;
const uniq = (p: string) => `${p}-${++qk}-${Math.random()}`;

describe('useQuery', () => {
  test('fn rejects → isError with the message, isLoading false', async () => {
    let r: any;
    const key = uniq('rej');
    function C() { r = useQuery({ key, fn: async () => { throw new Error('nope'); } }); return <Message text="x" />; }
    const root = createRoot(() => {});
    root.render(<C />);
    await waitFor(() => r?.isError);
    expect(r.error.message).toBe('nope');
    expect(r.isLoading).toBe(false);
    root.unmount();
  });

  test('timeout: 0 disables the timeout (slow fn still resolves)', async () => {
    let r: any;
    const key = uniq('t0');
    function C() { r = useQuery({ key, timeout: 0, fn: () => sleep(30).then(() => 'ok') }); return <Message text="x" />; }
    const root = createRoot(() => {});
    root.render(<C />);
    await waitFor(() => r?.data === 'ok');
    expect(r.isError).toBe(false);
    root.unmount();
  });

  test('timeout fires → TimeoutError and signal aborted', async () => {
    let r: any;
    let sig: AbortSignal | undefined;
    const key = uniq('to');
    function C() { r = useQuery({ key, timeout: 20, fn: ({ signal }) => { sig = signal; return new Promise(() => {}); } }); return <Message text="x" />; }
    const root = createRoot(() => {});
    root.render(<C />);
    await waitFor(() => r?.isError);
    expect(r.error.name).toBe('TimeoutError');
    expect(sig!.aborted).toBe(true);
    root.unmount();
  });

  test('key churn: only the latest key\'s data is shown', async () => {
    let r: any;
    let setK!: (k: string) => void;
    const base = uniq('churn');
    function C() {
      const [k, s] = useState(`${base}-0`);
      setK = s;
      r = useQuery({ key: k, fn: async () => { const d = Number(k.split('-').pop()); await sleep(d === 0 ? 50 : 5); return k; } });
      return <Message text="x" />;
    }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(5);
    setK(`${base}-1`);
    await sleep(5);
    setK(`${base}-2`);
    await sleep(80);
    expect(r.data).toBe(`${base}-2`);
    expect(r.isLoading).toBe(false);
    root.unmount();
  });

  test('switching from an in-flight key to an already-cached key clears isLoading', async () => {
    const cached = uniq('cached');
    const slow = uniq('slow');
    // Warm the cache for `cached` (global scope).
    let warm: any;
    function Warm() { warm = useQuery({ key: cached, scope: 'global', fn: async () => 'CACHED' }); return <Message text="x" />; }
    const wr = createRoot(() => {});
    wr.render(<Warm />);
    await waitFor(() => warm?.data === 'CACHED');
    wr.unmount();

    let r: any;
    let setK!: (k: string) => void;
    function C() {
      const [k, s] = useState(slow);
      setK = s;
      r = useQuery({ key: k, scope: 'global', fn: () => new Promise(() => {}) });
      return <Message text="x" />;
    }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(10);
    expect(r.isLoading).toBe(true);
    setK(cached);
    await sleep(20);
    expect(r.data).toBe('CACHED');
    expect(r.isLoading).toBe(false);
    root.unmount();
  });

  test('switching from a failed key to an already-cached key clears the old error', async () => {
    const cached = uniq('cached2');
    const bad = uniq('bad');
    let warm: any;
    function Warm() { warm = useQuery({ key: cached, scope: 'global', fn: async () => 'OK' }); return <Message text="x" />; }
    const wr = createRoot(() => {});
    wr.render(<Warm />);
    await waitFor(() => warm?.data === 'OK');
    wr.unmount();

    let r: any;
    let setK!: (k: string) => void;
    function C() {
      const [k, s] = useState(bad);
      setK = s;
      r = useQuery({ key: k, scope: 'global', fn: async () => { if (k === bad) throw new Error('bad'); return 'fresh'; } });
      return <Message text="x" />;
    }
    const root = createRoot(() => {});
    root.render(<C />);
    await waitFor(() => r?.isError);
    setK(cached);
    await sleep(20);
    expect(r.data).toBe('OK');
    expect(r.isError).toBe(false);
    expect(r.isSuccess).toBe(true);
    root.unmount();
  });

  test('a query that resolves to undefined does not leave the next mount stuck loading', async () => {
    const key = uniq('undef');
    let a: any;
    function A() { a = useQuery({ key, scope: 'global', fn: async () => undefined }); return <Message text="x" />; }
    const ra = createRoot(() => {});
    ra.render(<A />);
    await waitFor(() => a && !a.isLoading);
    ra.unmount();
    let b: any;
    function B() { b = useQuery({ key, scope: 'global', fn: async () => undefined }); return <Message text="x" />; }
    const rb = createRoot(() => {});
    rb.render(<B />);
    await sleep(30);
    expect(b.isLoading).toBe(false);
    rb.unmount();
  });

  test('scope chat isolates; scope global shares', async () => {
    const key = uniq('scope');
    let calls = 0;
    function C() {
      const q = useQuery({ key, fn: async () => `v${++calls}` });
      const g = useQuery({ key: `${key}-g`, scope: 'global', fn: async () => `g${++calls}` });
      return <Message text={`${q.data ?? '…'}|${g.data ?? '…'}`} />;
    }
    const t = await createTestBot({ component: C });
    await t.send('hi');
    await sleep(20);
    await t.adapter.simulateMessage('2', '2', 'hi');
    await sleep(20);
    const chat1 = serializeOutput(t.adapter.edited.filter((e) => String(e.chatId) === '1').at(-1)!.output).text!;
    const lastChat2 = [...t.adapter.sent, ...t.adapter.edited].filter((e) => String(e.chatId) === '2').sort((x, y) => x.timestamp - y.timestamp).at(-1)!;
    const chat2 = serializeOutput(lastChat2.output).text!;
    const [q1, g1] = chat1.split('|');
    const [q2, g2] = chat2.split('|');
    expect(q1).not.toBe(q2);
    expect(g1).toBe(g2);
    await t.stop();
  });
});

describe('useMutation', () => {
  test('errors set isError and call onError; success after error clears it', async () => {
    let m: any;
    const errs: string[] = [];
    function C() {
      m = useMutation({ fn: async (v: number) => { if (v < 0) throw new Error('neg'); return v * 2; }, onError: (e) => errs.push(e.message) });
      return <Message text="x" />;
    }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(5);
    expect(await m.mutate(-1)).toBeUndefined();
    await sleep(5);
    expect(m.isError).toBe(true);
    expect(errs).toEqual(['neg']);
    expect(await m.mutate(2)).toBe(4);
    await sleep(5);
    expect(m.isError).toBe(false);
    expect(m.isSuccess).toBe(true);
    expect(m.data).toBe(4);
    root.unmount();
  });

  test('a slow earlier failure does not overwrite the result of a later successful mutate', async () => {
    let m: any;
    function C() {
      m = useMutation({ fn: async (v: { ms: number; fail: boolean }) => { await sleep(v.ms); if (v.fail) throw new Error('old'); return 'new'; } });
      return <Message text="x" />;
    }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(5);
    const p1 = m.mutate({ ms: 40, fail: true });
    const p2 = m.mutate({ ms: 5, fail: false });
    await Promise.all([p1, p2]);
    await sleep(5);
    expect(m.data).toBe('new');
    expect(m.isError).toBe(false);
    expect(m.isLoading).toBe(false);
    root.unmount();
  });

  test('isLoading stays true while ANY mutate is in flight', async () => {
    let m: any;
    function C() { m = useMutation({ fn: (ms: number) => sleep(ms) }); return <Message text="x" />; }
    const root = createRoot(() => {});
    root.render(<C />);
    await sleep(5);
    const p1 = m.mutate(60);
    const p2 = m.mutate(5);
    await p2;
    await sleep(5);
    expect(m.isLoading).toBe(true);
    await p1;
    root.unmount();
  });
});

// =======================================================================================
// 11. inline queries
// =======================================================================================
describe('inlineQueryPlugin', () => {
  const inlineUpdate = (query: string, offset = '') => ({
    update_id: updateId++,
    inline_query: { id: `iq${updateId}`, from: tgUser, query, offset },
  });

  test('>50 results are clamped to 50 with a warning', async () => {
    const plugin = inlineQueryPlugin(() => Array.from({ length: 60 }, (_, i) => inlineArticle({ id: `r${i}`, title: 't', text: 'x' })));
    const { tg, hit } = tgBot(() => <Message text="x" />, { plugins: [plugin] });
    const w = silenceWarn();
    await hit(inlineUpdate('q'));
    const warned = w.mock.calls.length > 0;
    w.mockRestore();
    const ans = tg.of('answerInlineQuery')[0];
    expect(ans.params.results.length).toBe(50);
    expect(warned).toBe(true);
  });

  test('empty query and offsets pass through', async () => {
    const seen: { q: string; o: string }[] = [];
    const plugin = inlineQueryPlugin(({ query, offset }) => {
      seen.push({ q: query, o: offset });
      return { results: [inlineArticle({ title: 'a', text: 'b' })], nextOffset: String(Number(offset || 0) + 1) };
    });
    const { tg, hit } = tgBot(() => <Message text="x" />, { plugins: [plugin] });
    await hit(inlineUpdate(''));
    await hit(inlineUpdate('', '1'));
    expect(seen).toEqual([{ q: '', o: '' }, { q: '', o: '1' }]);
    expect(tg.of('answerInlineQuery').map((a) => a.params.next_offset)).toEqual(['1', '2']);
  });

  test('handler throws → error logged, no crash, and the webhook still returns 200', async () => {
    const plugin = inlineQueryPlugin(() => { throw new Error('search down'); });
    const { hit } = tgBot(() => <Message text="x" />, { plugins: [plugin] });
    const e = spyOn(console, 'error').mockImplementation(() => {});
    const res = await hit(inlineUpdate('q'));
    const logged = e.mock.calls.some((c) => String(c[1] ?? c[0]).includes('search down'));
    e.mockRestore();
    expect(res.status).toBe(200);
    expect(logged).toBe(true);
  });

  test.todo('handler throws → should still answerInlineQuery with [] (cache_time 0) so the client stops spinning — currently never answered', () => {});

  test('duplicate result ids are de-duplicated (Telegram rejects the whole answer otherwise)', async () => {
    const plugin = inlineQueryPlugin(() => [
      inlineArticle({ id: 'same', title: 'a', text: 'a' }),
      inlineArticle({ id: 'same', title: 'b', text: 'b' }),
    ]);
    const { tg, hit } = tgBot(() => <Message text="x" />, { plugins: [plugin] });
    const w = silenceWarn();
    const e = spyOn(console, 'error').mockImplementation(() => {});
    await hit(inlineUpdate('q'));
    w.mockRestore(); e.mockRestore();
    const ids = tg.of('answerInlineQuery')[0].params.results.map((r: any) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// =======================================================================================
// 12. bot.send / bot.broadcast
// =======================================================================================
describe('bot.send / bot.broadcast', () => {
  test('bot.send to an invalid chat rejects with the Telegram error', async () => {
    const { bot } = tgBot(() => <Message text="x" />, {}, (m, p) => (m === 'sendMessage' && p.chat_id === 'nope' ? { code: 400, description: 'Bad Request: chat not found' } : null));
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    await expect(bot.send('nope', 'hi')).rejects.toThrow(/chat not found/);
  });

  test('bot.send renders JSX with formatting & escaping', async () => {
    const { bot, tg } = tgBot(() => <Message text="x" />);
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    await bot.send(7, <Message>Hi <Bold>{'<you>'}</Bold></Message>);
    const s = tg.of('sendMessage').at(-1)!;
    expect(s.params.text).toBe('Hi <b>&lt;you&gt;</b>');
    expect(s.params.parse_mode).toBe('HTML');
  });

  test('broadcast with 0 ids → nothing sent', async () => {
    const { bot, tg } = tgBot(() => <Message text="x" />);
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    const before = tg.of('sendMessage').length;
    expect(await bot.broadcast([], <Message text="b" />)).toEqual({ sent: 0, failed: [] });
    expect(tg.of('sendMessage').length).toBe(before);
  });

  test('broadcast de-duplicates chat ids (no user gets the message twice)', async () => {
    const { bot, tg } = tgBot(() => <Message text="x" />);
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    const before = tg.of('sendMessage').length;
    const r = await bot.broadcast([1, '1', 2], 'news', { perSecond: 30 });
    const sends = tg.of('sendMessage').slice(before);
    expect(sends.map((s) => String(s.params.chat_id))).toEqual(['1', '2']);
    expect(r.sent).toBe(2);
  });

  test('broadcast collects failures and continues', async () => {
    const { bot } = tgBot(() => <Message text="x" />, {}, (m, p) => (m === 'sendMessage' && p.chat_id === '2' ? { code: 403, description: 'Forbidden: bot was blocked by the user' } : null));
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    const r = await bot.broadcast([1, 2, 3], 'news', { perSecond: 30 });
    expect(r.sent).toBe(2);
    expect(r.failed.map((f) => f.chatId)).toEqual(['2']);
  });

  test('broadcast honours an abort signal mid-run', async () => {
    const { bot, tg } = tgBot(() => <Message text="x" />);
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    const before = tg.of('sendMessage').length;
    const ac = new AbortController();
    const r = await bot.broadcast([1, 2, 3, 4], 'news', {
      perSecond: 30,
      signal: ac.signal,
      onProgress: (done) => { if (done === 2) ac.abort(); },
    });
    expect(r.sent).toBe(2);
    expect(tg.of('sendMessage').length - before).toBe(2);
  });

  test('broadcast of an unsendable (empty) message does not report it as sent', async () => {
    const { bot } = tgBot(() => <Message text="x" />);
    await bot.fetch(post(textUpdate('init')), { token: TOKEN });
    const r = await bot.broadcast([1, 2], <Message />, { perSecond: 30 });
    expect(r.sent).toBe(0);
  });
});

// =======================================================================================
// 13. useOn / useEventData
// =======================================================================================
describe('useOn / useEventData', () => {
  test('useOn handler that throws is reported via onError and the bot keeps answering', async () => {
    const errors: unknown[] = [];
    function C() {
      useOn('text', (m) => { if (m.text === 'boom') throw new Error('handler exploded'); });
      return <Message text="alive" />;
    }
    const e = spyOn(console, 'error').mockImplementation(() => {});
    const t = await createTestBot({ component: C, onError: (err) => { errors.push(err); } });
    await t.send('boom');
    await sleep(20);
    await t.send('hello');
    await sleep(20);
    e.mockRestore();
    expect(errors.some((x) => (x as Error)?.message === 'handler exploded')).toBe(true);
    expect(t.lastMessage?.text).toBe('alive');
    await t.stop();
  });

  const cases: [TelegramEvent, Record<string, unknown>, unknown][] = [
    ['photo', { message: { message_id: 1, photo: [{ file_id: 'p' }] } }, [{ file_id: 'p' }]],
    ['video', { message: { message_id: 1, video: { file_id: 'v' } } }, { file_id: 'v' }],
    ['audio', { message: { message_id: 1, audio: { file_id: 'a' } } }, { file_id: 'a' }],
    ['voice', { message: { message_id: 1, voice: { file_id: 'vo' } } }, { file_id: 'vo' }],
    ['document', { message: { message_id: 1, document: { file_id: 'd' } } }, { file_id: 'd' }],
    ['sticker', { message: { message_id: 1, sticker: { file_id: 's' } } }, { file_id: 's' }],
    ['contact', { message: { message_id: 1, contact: { phone_number: '1' } } }, { phone_number: '1' }],
    ['location', { message: { message_id: 1, location: { latitude: 1, longitude: 2 } } }, { latitude: 1, longitude: 2 }],
    ['venue', { message: { message_id: 1, venue: { title: 'v' } } }, { title: 'v' }],
    ['animation', { message: { message_id: 1, animation: { file_id: 'g' } } }, { file_id: 'g' }],
    ['video_note', { message: { message_id: 1, video_note: { file_id: 'vn' } } }, { file_id: 'vn' }],
    ['poll', { poll: { id: 'P' } }, { id: 'P' }],
    ['poll_answer', { poll_answer: { poll_id: 'P', option_ids: [0] } }, { poll_id: 'P', option_ids: [0] }],
    ['new_chat_members', { message: { message_id: 1, new_chat_members: [{ id: 5 }] } }, [{ id: 5 }]],
    ['left_chat_member', { message: { message_id: 1, left_chat_member: { id: 5 } } }, { id: 5 }],
    ['dice', { message: { message_id: 1, dice: { value: 6 } } }, { value: 6 }],
    ['web_app_data', { message: { message_id: 1, web_app_data: { data: 'w' } } }, { data: 'w' }],
    ['successful_payment', { message: { message_id: 1, successful_payment: { total_amount: 1 } } }, { total_amount: 1 }],
    ['edited_message', { edited_message: { message_id: 1, text: 'e' } }, { message_id: 1, text: 'e' }],
    ['my_chat_member', { my_chat_member: { new_chat_member: { status: 'kicked' } } }, { new_chat_member: { status: 'kicked' } }],
    ['chat_member', { chat_member: { new_chat_member: { status: 'member' } } }, { new_chat_member: { status: 'member' } }],
    ['message_reaction', { message_reaction: { new_reaction: [] } }, { new_reaction: [] }],
    ['shipping_query', { shipping_query: { id: 's' } }, { id: 's' }],
    ['pre_checkout_query', { pre_checkout_query: { id: 'pc' } }, { id: 'pc' }],
  ];

  for (const [event, raw, expected] of cases) {
    test(`useEventData('${event}') returns the payload; other events return null`, async () => {
      let got: unknown = 'unset';
      let other: unknown = 'unset';
      function C() {
        got = useEventData(event);
        other = useEventData(event === 'photo' ? 'video' : 'photo');
        return <Message text="x" />;
      }
      const t = await createTestBot({ component: C });
      await t.send('hi'); // events only re-render a chat that already has a live UI
      await t.event(event, raw);
      expect(got).toEqual(expected);
      expect(other).toBeNull();
      await t.stop();
    });
  }

  test('useEventData("text") ignores edited messages (edits are not new text)', async () => {
    let got: unknown = 'unset';
    function C() { got = useEventData('text'); return <Message text="x" />; }
    const t = await createTestBot({ component: C });
    await t.send('hi');
    await t.event('edited_message', { edited_message: { message_id: 1, text: 'edit' } });
    expect(got).toBeNull();
    await t.stop();
  });

  test.todo('useOn treats update_id 0 as "no id" (`!updateId`, event-hooks.ts) and skips the handler — harmless with real Telegram ids (always positive), but a falsy check on an id', () => {});
});
