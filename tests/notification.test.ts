import { describe, test, expect } from 'bun:test';
import { TelegramAdapter } from '../packages/telegram/src';
import type { OutputNode } from '../packages/core/src/renderer';

/** Drives a real grammY update through the adapter with every API call mocked. */
function mockApi(adapter: TelegramAdapter, calls: { method: string; payload: any }[]) {
  adapter.getBot().api.config.use((async (_prev: any, method: string, payload: any) => {
    calls.push({ method, payload });
    return {
      ok: true,
      result: method === 'getMe'
        ? { id: 1, is_bot: true, first_name: 'Bot', username: 'bot' }
        : { message_id: 42 },
    };
  }) as any);
}

const callbackUpdate = {
  update_id: 1,
  callback_query: {
    id: 'q1',
    from: { id: 2, is_bot: false, first_name: 'T' },
    message: { message_id: 5, date: 0, chat: { id: 1, type: 'private' }, text: 'hi' },
    chat_instance: 'ci',
    data: 'x',
  },
};

describe('Notification — answers the callback query after render', () => {
  test('a rendered <Notification> becomes an answerCallbackQuery with text + show_alert', async () => {
    const adapter = new TelegramAdapter();
    await adapter.connect({ token: '123:FAKE' });
    const calls: { method: string; payload: any }[] = [];
    mockApi(adapter, calls);

    // The render (emit) responds by "sending" a notification-only tree.
    adapter.on('callback_query', async (ctx) => {
      const note: OutputNode = { type: 'tg-notification', props: { text: 'Saved!', showAlert: true }, children: [] };
      await adapter.send(Number(ctx.chatId), note);
    });

    const handler = adapter.webhookCallback({});
    await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(callbackUpdate) }));

    const ans = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(ans).toBeDefined();
    expect(ans!.payload.text).toBe('Saved!');
    expect(ans!.payload.show_alert).toBe(true);
    await adapter.disconnect();
  });

  test('with no <Notification>, the query is still answered (stops the button spinner)', async () => {
    const adapter = new TelegramAdapter();
    await adapter.connect({ token: '123:FAKE' });
    const calls: { method: string; payload: any }[] = [];
    mockApi(adapter, calls);

    adapter.on('callback_query', async () => { /* render without a notification */ });

    const handler = adapter.webhookCallback({});
    await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(callbackUpdate) }));

    const ans = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(ans).toBeDefined();
    expect(ans!.payload?.text).toBeUndefined();
    await adapter.disconnect();
  });
});
