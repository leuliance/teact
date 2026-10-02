import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import {
  createBot,
  rateLimitPlugin,
  loggerPlugin,
  kvSessionStore,
  useChatAction,
  useInterval,
  useDeepLink,
  useSession,
} from '../packages/core/src';
import {
  Message, InlineKeyboard, Button, Bold, Underline, Strike, Spoiler, Link, Mention, Quote,
  Pagination, usePagination, Confirm,
} from '../packages/ui/src';
import { TelegramAdapter, fetchDriver, serializeOutput, inlineQueryPlugin, inlineArticle } from '../packages/telegram/src';
import { createTestBot } from '../packages/testing/src';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderTree(el: React.ReactElement): Promise<OutputNode> {
  let out: OutputNode | null = null;
  const root = createRoot((t) => { out = t; });
  root.render(el);
  await sleep(10);
  return out!;
}

describe('formatting components', () => {
  test('render Telegram HTML with escaping', async () => {
    const tree = await renderTree(
      <Message>
        <Bold>b</Bold> <Underline>u</Underline> <Strike>s</Strike> <Spoiler>x</Spoiler>{' '}
        <Link href={'https://a.co/?q="1"&r=2'}>a &lt; b</Link> <Mention userId={42}>Ada</Mention>
        <Quote expandable>long</Quote>
      </Message>,
    );
    const p = serializeOutput(tree);
    expect(p.parseMode).toBe('HTML');
    expect(p.text).toBe(
      '<b>b</b> <u>u</u> <s>s</s> <tg-spoiler>x</tg-spoiler> ' +
      '<a href="https://a.co/?q=&quot;1&quot;&amp;r=2">a &lt; b</a> <a href="tg://user?id=42">Ada</a>' +
      '<blockquote expandable>long</blockquote>',
    );
  });
});

describe('Pagination + usePagination', () => {
  test('pages through a list and clamps at the ends', async () => {
    const items = Array.from({ length: 12 }, (_, i) => `item${i + 1}`);
    function List() {
      const pager = usePagination(items, { pageSize: 5 });
      return (
        <Message text={pager.items.join(',')}>
          <InlineKeyboard>
            <Pagination page={pager.page} pageCount={pager.pageCount} onChange={pager.goTo} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: List });
    await t.send('hi');
    expect(t.lastMessage?.text).toBe('item1,item2,item3,item4,item5');
    expect(t.lastMessage?.buttons[0].map((b) => b.text)).toEqual(['·', '1 / 3', '›']);
    await t.click('›');
    await t.click('›');
    expect(t.lastMessage?.text).toBe('item11,item12');
    expect(t.lastMessage?.buttons[0].map((b) => b.text)).toEqual(['‹', '3 / 3', '·']);
    await t.click('3 / 3'); // label is inert
    expect(t.lastMessage?.text).toBe('item11,item12');
    await t.stop();
  });
});

describe('Confirm', () => {
  test('calls onConfirm / onCancel', async () => {
    function Danger() {
      const [state, setState] = useState<'ask' | 'yes' | 'no'>('ask');
      if (state !== 'ask') return <Message text={state} />;
      return <Confirm text="Sure?" destructive onConfirm={() => setState('yes')} onCancel={() => setState('no')} />;
    }
    const t = await createTestBot({ component: Danger });
    await t.send('x');
    await t.click('Yes');
    expect(t.lastMessage?.text).toBe('yes');
    await t.stop();
  });
});

describe('rateLimitPlugin', () => {
  test('drops updates over the limit and warns once', async () => {
    const t = await createTestBot({
      component: () => <Message text="ok" />,
      plugins: [rateLimitPlugin({ limit: 2, windowMs: 10_000, onLimited: () => 'Slow down' })],
    });
    for (let i = 0; i < 5; i++) await t.send(`m${i}`);
    expect(t.messages.filter((m) => m.text === 'ok')).toHaveLength(2);
    expect(t.apiCalls.filter((c) => c.method === 'sendMessage').map((c) => c.params.text)).toEqual(['Slow down']);
    await t.stop();
  });
});

describe('loggerPlugin', () => {
  test('logs each update with timing', async () => {
    const lines: string[] = [];
    const t = await createTestBot({ component: () => <Message text="ok" />, plugins: [loggerPlugin({ log: (l) => lines.push(l) })] });
    await t.send('/start');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[teact\] ← Test in 1: "\/start" \(\d+ms\)$/);
    await t.stop();
  });
});

describe('kvSessionStore', () => {
  test('persists sessions as JSON through any async KV (Cloudflare-style namespace)', async () => {
    const kv = new Map<string, string>();
    const ns = {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string, o?: { expirationTtl?: number }) => { kv.set(k, v); expect(o?.expirationTtl).toBe(3600); },
      delete: async (k: string) => { kv.delete(k); },
    };
    function Visits() {
      const [s, set] = useSession<{ n?: number }>();
      return (
        <Message text={`n=${s.n ?? 0}`}>
          <InlineKeyboard><Button text="inc" onClick={() => set({ n: (s.n ?? 0) + 1 })} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Visits, session: { store: kvSessionStore(ns, { ttlSeconds: 3600 }) } });
    await t.send('hi');
    await t.click('inc');
    expect(JSON.parse(kv.get('teact:session:mock:1')!)).toEqual({ n: 1 });
    await t.stop();
  });
});

describe('utility hooks', () => {
  test('useChatAction keeps "typing" alive while active', async () => {
    function Busy() {
      const [busy, setBusy] = useState(true);
      useChatAction('typing', busy);
      return (
        <Message text={busy ? 'working' : 'done'}>
          <InlineKeyboard><Button text="stop" onClick={() => setBusy(false)} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Busy });
    await t.send('go');
    await sleep(20);
    expect(t.apiCalls.filter((c) => c.method === 'sendChatAction').map((c) => c.params.action)).toContain('typing');
    await t.click('stop');
    await t.stop();
  });

  test('useInterval drives live updates', async () => {
    function Countdown() {
      const [left, setLeft] = useState(3);
      useInterval(() => setLeft((s) => s - 1), left > 0 ? 50 : null);
      return <Message text={left > 0 ? `${left}` : 'liftoff'} />;
    }
    const t = await createTestBot({ component: Countdown });
    await t.send('go');
    await sleep(400);
    expect(t.lastMessage?.text).toBe('liftoff');
    await t.stop();
  });

  test('useDeepLink reads /start payloads and builds links', async () => {
    let seen: string | undefined;
    let link = '';
    function Ref() {
      const dl = useDeepLink();
      seen = dl.payload;
      link = dl.link('ref_42');
      return <Message text="hi" />;
    }
    const t = await createTestBot({ component: Ref });
    await t.adapter.simulateMessage('1', '1', '/start ref_7', { botUsername: 'teact_bot' });
    expect(seen).toBe('ref_7');
    expect(link).toBe('https://t.me/teact_bot?start=ref_42');
    await t.stop();
  });
});

describe('bot.broadcast', () => {
  test('sends to every chat, collects failures, reports progress', async () => {
    const t = await createTestBot({ component: () => <Message text="x" /> });
    const original = t.adapter.send.bind(t.adapter);
    t.adapter.send = async (chatId, output, opts) => {
      if (String(chatId) === '13') throw new Error('Forbidden: bot was blocked by the user');
      return original(chatId, output, opts);
    };
    const progress: number[] = [];
    const report = await t.bot.broadcast(['11', '12', '13', '14'], <Message text="📢 News" />, {
      perSecond: 30,
      onProgress: (done) => progress.push(done),
    });
    expect(report.sent).toBe(3);
    expect(report.failed.map((f) => f.chatId)).toEqual(['13']);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(t.adapter.sent.map((s) => s.chatId)).toEqual(['11', '12', '14']);
    await t.stop();
  });
});

describe('inlineQueryPlugin', () => {
  test('answers inline queries through the adapter API', async () => {
    const calls: { method: string; params: any }[] = [];
    const fakeFetch = (async (url: string, init: any) => {
      const method = url.split('/').pop()!;
      calls.push({ method, params: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: method === 'getMe' ? { id: 1, is_bot: true, first_name: 'B', username: 'b' } : true }));
    }) as unknown as typeof fetch;
    const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: fakeFetch }) });
    const bot = createBot({
      adapter,
      component: () => <Message text="x" />,
      plugins: [inlineQueryPlugin(({ query }) => [inlineArticle({ id: '1', title: query.toUpperCase(), text: `You said ${query}` })])],
    });
    const res = await bot.fetch(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify({ update_id: 1, inline_query: { id: 'iq1', from: { id: 5, is_bot: false, first_name: 'A' }, query: 'pika', offset: '' } }),
    }), { token: '1:T' });
    expect(res.status).toBe(200);
    const answer = calls.find((c) => c.method === 'answerInlineQuery')!;
    expect(answer.params).toEqual({
      inline_query_id: 'iq1',
      results: [{ type: 'article', id: '1', title: 'PIKA', input_message_content: { message_text: 'You said pika' } }],
    });
    await bot.stop();
  });
});
