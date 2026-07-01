import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createBot } from '../packages/core/src';
import { Message } from '../packages/ui/src';
import { MockAdapter } from '../packages/testing/src';
import { TelegramAdapter } from '../packages/telegram/src';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('serverless webhook — bot.fetch()', () => {
  test('processes a webhook Request and renders (no polling)', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({
      component: () => <Message text="hello from a worker" />,
      adapter,
      token: 'test',
    });

    const req = new Request('https://bot.example.com/webhook', {
      method: 'POST',
      body: JSON.stringify({ text: '/start' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await bot.fetch(req);
    expect(res.status).toBe(200);

    await wait();
    expect(adapter.getLastSent()?.output.props.text).toBe('hello from a worker');
  });

  test('token can be supplied per-request (Cloudflare env pattern)', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ component: () => <Message text="ok" />, adapter });
    // no token at construction — provided at fetch time like env.TELEGRAM_BOT_TOKEN
    const req = new Request('https://x/', { method: 'POST', body: JSON.stringify({ text: 'hi' }) });
    const res = await bot.fetch(req, { token: 'from-env' });
    expect(res.status).toBe(200);
    await wait();
    expect(adapter.getLastSent()?.output.props.text).toBe('ok');
    await bot.stop();
  });
});

describe('TelegramAdapter.webhookCallback (grammY std/http)', () => {
  test('returns a web-standard handler and dispatches updates without network', async () => {
    const adapter = new TelegramAdapter();
    await adapter.connect({ token: '123:FAKE' });
    // Mock every Telegram API call (incl. getMe) so nothing hits the network.
    adapter.getBot().api.config.use(((_prev: any, method: string) =>
      Promise.resolve({
        ok: true,
        result: method === 'getMe'
          ? { id: 1, is_bot: true, first_name: 'Bot', username: 'bot' }
          : {},
      })) as any);

    let received: string | undefined;
    adapter.on('message', (ctx) => { received = ctx.text; });

    const handler = adapter.webhookCallback({});
    const update = {
      update_id: 1,
      message: {
        message_id: 5, date: 0,
        chat: { id: 1, type: 'private' },
        from: { id: 2, is_bot: false, first_name: 'T' },
        text: 'hello',
      },
    };
    const res = await handler(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify(update),
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBeLessThan(500);
    await wait();
    expect(received).toBe('hello');
    await adapter.disconnect();
  });
});
