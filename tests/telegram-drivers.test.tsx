/**
 * End-to-end driver matrix: the SAME bot runs on the zero-dep fetch driver, on grammY and on
 * GramIO, against a fake Telegram Bot API server. Proves the adapter is framework-agnostic —
 * identical Bot API traffic whatever client library sits underneath.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import React, { useState } from 'react';
import { Bot as GrammyBot } from 'grammy';
import { Bot as GramioBot } from 'gramio';
import { createBot, useSession } from '../packages/core/src';
import { Message, InlineKeyboard, Button, Notification } from '../packages/ui/src';
import {
  TelegramAdapter,
  fetchDriver,
  conversationsPlugin,
  type TelegramDriver,
} from '../packages/telegram/src';
import { grammyDriver } from '../packages/telegram/src/grammy';
import { gramioDriver } from '../packages/telegram/src/gramio';

const TOKEN = '123:FAKE';
const ME = { id: 999, is_bot: true, first_name: 'Teact', username: 'teact_bot' };

interface Call { method: string; params: any }

/** A tiny fake Bot API: records calls, returns plausible results. */
function fakeTelegram() {
  const calls: Call[] = [];
  let nextMessageId = 500;
  const fetchImpl = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = url.split('/').pop()!.split('?')[0];
    const req = new Request(url, { method: 'POST', headers: init?.headers, body: init?.body });
    let params: any = {};
    const type = req.headers.get('content-type') ?? '';
    if (type.includes('json')) params = await req.json().catch(() => ({}));
    else if (type.includes('form')) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        try { params[k] = typeof v === 'string' ? JSON.parse(v) : v; } catch { params[k] = v; }
      }
    }
    calls.push({ method, params });
    let result: any = true;
    if (method === 'getMe') result = ME;
    else if (method.startsWith('send')) result = { message_id: nextMessageId++, date: 0, chat: { id: params.chat_id, type: 'private' } };
    else if (method.startsWith('edit')) result = { message_id: params.message_id, date: 0, chat: { id: params.chat_id, type: 'private' } };
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return {
    calls,
    fetch: fetchImpl,
    of: (m: string) => calls.filter((c) => c.method === m),
  };
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type DriverCase = { name: string; make: (tg: ReturnType<typeof fakeTelegram>) => TelegramDriver; native?: boolean };

const DRIVERS: DriverCase[] = [
  { name: 'fetch', make: (tg) => fetchDriver({ fetch: tg.fetch }) },
  {
    name: 'grammy',
    native: true,
    make: (tg) => grammyDriver(new GrammyBot(TOKEN, { client: { fetch: tg.fetch as any } })),
  },
  {
    name: 'gramio',
    native: true,
    make: (tg) => {
      globalThis.fetch = tg.fetch; // GramIO uses the global fetch
      return gramioDriver(new GramioBot(TOKEN));
    },
  },
];

let updateId = 1;
const user = { id: 42, is_bot: false, first_name: 'Ada' };
const chat = { id: 42, type: 'private' as const, first_name: 'Ada' };
const textUpdate = (text: string) => ({
  update_id: updateId++,
  message: { message_id: updateId + 1000, date: 0, chat, from: user, text },
});
const callbackUpdate = (data: string, messageId: number) => ({
  update_id: updateId++,
  callback_query: {
    id: `q${updateId}`, from: user, chat_instance: 'ci', data,
    message: { message_id: messageId, date: 0, chat, from: ME, text: 'x' },
  },
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://bot.example/webhook', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <Button text="+1" onClick={() => setCount((c) => c + 1)} />
        <Button text="Ping" onClick="ping" />
      </InlineKeyboard>
      {count === 2 ? <Notification text="Two!" showAlert /> : null}
    </Message>
  );
}

for (const d of DRIVERS) {
  describe(`TelegramAdapter on the ${d.name} driver`, () => {
    test('renders /start, then edits in place on button taps and answers the query', async () => {
      const tg = fakeTelegram();
      const adapter = new TelegramAdapter({ driver: d.make(tg) });
      const bot = createBot({ adapter, component: Counter, commands: { start: { description: 'Start' } } });

      expect((await bot.fetch(post(textUpdate('/start')), { token: TOKEN })).status).toBe(200);
      const [sent] = tg.of('sendMessage');
      expect(sent.params.chat_id).toBe('42');
      expect(sent.params.text).toBe('Count: 0');
      const firstButton = sent.params.reply_markup.inline_keyboard[0][0];
      expect(firstButton.text).toBe('+1');
      const msgId = 500;

      await bot.fetch(post(callbackUpdate(firstButton.callback_data, msgId)));
      const [edit] = tg.of('editMessageText');
      expect(edit.params).toMatchObject({ chat_id: '42', message_id: msgId, text: 'Count: 1' });
      expect(tg.of('answerCallbackQuery')).toHaveLength(1);
      expect(tg.of('answerCallbackQuery')[0].params.text).toBeUndefined();

      // Second tap renders a <Notification> → the query answer carries it as an alert.
      await bot.fetch(post(callbackUpdate(firstButton.callback_data, msgId)));
      const answer = tg.of('answerCallbackQuery')[1];
      expect(answer.params).toMatchObject({ text: 'Two!', show_alert: true });
      await bot.stop();
    });

    test('a tap that changes nothing makes no edit call', async () => {
      const tg = fakeTelegram();
      const adapter = new TelegramAdapter({ driver: d.make(tg) });
      const bot = createBot({ adapter, component: Counter, commands: { start: { description: 'Start' } } });
      await bot.fetch(post(textUpdate('/start')), { token: TOKEN });
      await bot.fetch(post(callbackUpdate('ping', 500)));
      expect(tg.of('editMessageText')).toHaveLength(0);
      expect(tg.of('answerCallbackQuery')).toHaveLength(1);
      await bot.stop();
    });

    test('rejects webhook requests with a wrong secret token', async () => {
      const tg = fakeTelegram();
      const adapter = new TelegramAdapter({ driver: d.make(tg) });
      const bot = createBot({ adapter, component: Counter });
      const res = await bot.fetch(post(textUpdate('hi'), { 'x-telegram-bot-api-secret-token': 'nope' }), { token: TOKEN, secretToken: 's3cret' });
      expect(res.status).toBe(401);
      expect(tg.of('sendMessage')).toHaveLength(0);
      await bot.stop();
    });

    test('imperative conversations work on this driver', async () => {
      const tg = fakeTelegram();
      const adapter = new TelegramAdapter({ driver: d.make(tg) });
      const bot = createBot({
        adapter,
        component: () => <Message text="home" />,
        plugins: [conversationsPlugin({
          signup: {
            command: 'signup',
            handler: async (c) => {
              const name = await c.prompt('Name?', { validate: (v) => v.length >= 2 || 'Too short' });
              const plan = await c.ask('Plan?', [[{ text: 'Free', value: 'free' }, { text: 'Pro', value: 'pro' }]]);
              await c.send(`Hi ${name} (${plan})`);
            },
          },
        })],
      });

      await bot.fetch(post(textUpdate('/signup')), { token: TOKEN });
      expect(tg.of('sendMessage').map((c) => c.params.text)).toEqual(['Name?']);
      await bot.fetch(post(textUpdate('A')));
      expect(tg.of('sendMessage').at(-1)!.params.text).toBe('⚠️ Too short\n\nName?');
      await bot.fetch(post(textUpdate('Ada')));
      const ask = tg.of('sendMessage').at(-1)!;
      expect(ask.params.text).toBe('Plan?');
      const pro = ask.params.reply_markup.inline_keyboard[0][1].callback_data;
      await bot.fetch(post(callbackUpdate(pro, 600)));
      expect(tg.of('sendMessage').at(-1)!.params.text).toBe('Hi Ada (pro)');
      // The React tree never rendered during the conversation.
      expect(tg.of('sendMessage').some((c) => c.params.text === 'home')).toBe(false);
      await bot.stop();
    });

    test('useSession + api are exposed identically', async () => {
      const tg = fakeTelegram();
      const adapter = new TelegramAdapter({ driver: d.make(tg) });
      function Visits() {
        const [session, setSession] = useSession<{ n?: number }>();
        return (
          <Message text={`n=${session.n ?? 0}`}>
            <InlineKeyboard><Button text="inc" onClick={() => setSession({ n: (session.n ?? 0) + 1 })} /></InlineKeyboard>
          </Message>
        );
      }
      const bot = createBot({ adapter, component: Visits });
      await bot.fetch(post(textUpdate('hello')), { token: TOKEN });
      const cb = tg.of('sendMessage')[0].params.reply_markup.inline_keyboard[0][0].callback_data;
      await bot.fetch(post(callbackUpdate(cb, 500)));
      expect(tg.of('editMessageText')[0].params.text).toBe('n=1');

      await bot.api!.sendMessage({ chat_id: 7, text: 'direct' });
      expect(tg.of('sendMessage').at(-1)!.params).toMatchObject({ chat_id: 7, text: 'direct' });
      await bot.stop();
    });

    if (d.native) {
      test('the framework\'s own middleware runs before Teact', async () => {
        const tg = fakeTelegram();
        const driver = d.make(tg);
        const seen: string[] = [];
        driver.use!(async (ctx: any, next: () => Promise<void>) => { seen.push(ctx.update?.message?.text ?? '?'); await next(); });
        const adapter = new TelegramAdapter({ driver });
        const bot = createBot({ adapter, component: () => <Message text="ok" /> });
        await bot.fetch(post(textUpdate('hey')), { token: TOKEN });
        expect(seen).toEqual(['hey']);
        expect(tg.of('sendMessage')[0].params.text).toBe('ok');
        await bot.stop();
      });
    }
  });
}

describe('bot.send (proactive messages)', () => {
  test('sends text and JSX to an arbitrary chat', async () => {
    const tg = fakeTelegram();
    const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: tg.fetch }) });
    const bot = createBot({ adapter, component: () => <Message text="home" />, token: TOKEN });
    await bot.send(123, 'Reminder!');
    await bot.send(123, (
      <Message text="Open inbox">
        <InlineKeyboard><Button text="Inbox" route="/inbox" /></InlineKeyboard>
      </Message>
    ));
    const [a, b] = tg.of('sendMessage');
    expect(a.params).toMatchObject({ chat_id: '123', text: 'Reminder!' });
    expect(b.params.reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Inbox', callback_data: '__route:/inbox' });
    await bot.stop();
  });
});

describe('fetchDriver', () => {
  test('retries a 429 flood wait honouring retry_after', async () => {
    let n = 0;
    const flaky = (async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } }));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as unknown as typeof fetch;
    const driver = fetchDriver({ fetch: flaky });
    (driver as any).init && (await driver.init(TOKEN).catch(() => {}));
    n = 0;
    const res = await driver.call('sendMessage', { chat_id: 1, text: 'x' });
    expect(res).toEqual({ message_id: 1 });
    expect(n).toBe(2);
  });

  test('surfaces API errors as TelegramApiError without retrying 4xx', async () => {
    let n = 0;
    const bad = (async () => {
      n++;
      return new Response(JSON.stringify(n === 1
        ? { ok: true, result: ME }
        : { ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
    }) as unknown as typeof fetch;
    const driver = fetchDriver({ fetch: bad });
    await driver.init(TOKEN);
    await expect(driver.call('sendMessage', { chat_id: 1, text: 'x' })).rejects.toMatchObject({
      name: 'TelegramApiError', errorCode: 400, method: 'sendMessage',
    });
    expect(n).toBe(2);
  });
});
