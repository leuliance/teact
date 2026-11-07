/**
 * Battle tests: PAYMENTS — useInvoice, successful_payment flow, pre_checkout_query /
 * shipping_query answering in the TelegramAdapter.
 *
 * Tests are named by the EXPECTED correct behaviour — a failing test is a bug.
 * Design limitations / feature gaps are `test.todo` with notes.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import React from 'react';
import { createBot, useInvoice, useOn, type InvoiceConfig } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { createTestBot } from '../packages/testing/src';
import { TelegramAdapter, fetchDriver, type TelegramAdapterConfig } from '../packages/telegram/src';

// ───────────────────────────── helpers ─────────────────────────────

const BASE: InvoiceConfig = {
  title: 'Premium',
  description: 'Unlock all features',
  payload: 'premium-v1',
  providerToken: 'prov_tok',
  currency: 'USD',
  prices: [{ label: 'Premium', amount: 499 }],
};

const seen: { status: string; error: string | null; receipt: any }[] = [];

function makeShop(config: Partial<InvoiceConfig> = {}) {
  return function Shop() {
    const inv = useInvoice({ ...BASE, ...config });
    seen.push({ status: inv.status, error: inv.error, receipt: inv.receipt });
    return (
      <Message text={`status=${inv.status} error=${inv.error ?? '-'} paid=${inv.receipt?.totalAmount ?? '-'}`}>
        <InlineKeyboard>
          <Button text="Pay" onClick={inv.send} />
        </InlineKeyboard>
      </Message>
    );
  };
}

const lastState = () => seen.at(-1)!;

let inMsg = 5000;
let upd = 90_000;
/** Raw Telegram update carrying a successful_payment service message. */
function paymentRaw(chatId: number, userId: number, sp: Record<string, unknown>, updateId = upd++) {
  return {
    update_id: updateId,
    message: {
      message_id: inMsg++,
      date: 0,
      chat: { id: chatId, type: chatId < 0 ? 'group' : 'private' },
      from: { id: userId, is_bot: false, first_name: 'Ada' },
      successful_payment: sp,
    },
  };
}
const SP = (over: Record<string, unknown> = {}) => ({
  currency: 'USD',
  total_amount: 499,
  invoice_payload: 'premium-v1',
  telegram_payment_charge_id: 'tg_ch_1',
  provider_payment_charge_id: 'prov_ch_1',
  order_info: { name: 'Ada', email: 'ada@example.com' },
  ...over,
});

async function deliverPayment(t: Awaited<ReturnType<typeof createTestBot>>, raw: any, chatId = '1', userId = '1') {
  await t.adapter.simulateMessage(chatId, userId, undefined as unknown as string, {
    text: undefined,
    messageId: String(raw.message.message_id),
    raw,
  });
}

const invoices = (t: { apiCalls: { method: string; params: any }[] }) => t.apiCalls.filter((c) => c.method === 'sendInvoice');

// ───────────────────── engine-level: useInvoice ─────────────────────

describe('useInvoice — sendInvoice params', () => {
  test('sends exact Bot API params (chat_id, title, payload, currency, prices, provider_token)', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.send('hi');
    await t.click('Pay');
    const [call] = invoices(t);
    expect(call).toBeDefined();
    expect(call.params).toEqual({
      chat_id: '1',
      title: 'Premium',
      description: 'Unlock all features',
      payload: 'premium-v1',
      currency: 'USD',
      prices: [{ label: 'Premium', amount: 499 }],
      provider_token: 'prov_tok',
    });
    expect(lastState().status).toBe('pending');
    await t.stop();
  });

  test('maps every optional InvoiceConfig field to its snake_case param', async () => {
    const t = await createTestBot({
      component: makeShop({
        photoUrl: 'https://x/p.png', photoWidth: 512, photoHeight: 256, photoSize: 1000,
        needName: true, needPhoneNumber: true, needEmail: true, needShippingAddress: true,
        sendPhoneNumberToProvider: true, sendEmailToProvider: true, isFlexible: true,
        maxTipAmount: 1000, suggestedTipAmounts: [100, 200, 500], startParameter: 'sp',
        providerData: '{"a":1}', protectContent: true,
      }),
    });
    await t.send('hi');
    await t.click('Pay');
    expect(invoices(t)[0].params).toMatchObject({
      photo_url: 'https://x/p.png', photo_width: 512, photo_height: 256, photo_size: 1000,
      need_name: true, need_phone_number: true, need_email: true, need_shipping_address: true,
      send_phone_number_to_provider: true, send_email_to_provider: true, is_flexible: true,
      max_tip_amount: 1000, suggested_tip_amounts: [100, 200, 500], start_parameter: 'sp',
      provider_data: '{"a":1}', protect_content: true,
    });
    await t.stop();
  });

  test('XTR (Telegram Stars) without providerToken sends no provider_token', async () => {
    const t = await createTestBot({ component: makeShop({ currency: 'XTR', providerToken: '', prices: [{ label: 'Stars', amount: 50 }] }) });
    await t.send('hi');
    await t.click('Pay');
    const [call] = invoices(t);
    expect(call).toBeDefined();
    expect('provider_token' in call.params).toBe(false);
    expect(call.params.currency).toBe('XTR');
    expect(lastState().status).toBe('pending');
    await t.stop();
  });

  test('XTR with a (leftover) providerToken still omits provider_token — Stars must not use a provider', async () => {
    const t = await createTestBot({ component: makeShop({ currency: 'XTR', prices: [{ label: 'Stars', amount: 50 }] }) });
    await t.send('hi');
    await t.click('Pay');
    expect('provider_token' in invoices(t)[0].params).toBe(false);
    await t.stop();
  });

  test('forum topic: message_thread_id is passed', async () => {
    const t = await createTestBot({ component: makeShop(), chatId: '-1001' });
    await t.adapter.simulateMessage('-1001', '1', 'hi', { threadId: 7 });
    const last = t.adapter.getLastSent()!;
    expect(last.threadId).toBe(7);
    // Find the Pay button data
    const btn = JSON.stringify(last.output).match(/"callbackData":"([^"]+)"/)![1];
    await t.adapter.simulateCallback('-1001', '1', btn, String(last.messageId), { threadId: 7, callbackLabel: 'Pay' });
    expect(invoices(t)[0].params).toMatchObject({ chat_id: '-1001', message_thread_id: 7 });
    await t.stop();
  });

  test('group chat: invoice goes to the group chat id', async () => {
    const t = await createTestBot({ component: makeShop(), chatId: '-200', userId: '5' });
    await t.send('hi');
    await t.click('Pay');
    expect(invoices(t)[0].params.chat_id).toBe('-200');
    await t.stop();
  });
});

describe('useInvoice — failure modes', () => {
  test('missing providerToken for non-XTR → failed with helpful error and NO API call', async () => {
    const t = await createTestBot({ component: makeShop({ providerToken: '' }) });
    await t.send('hi');
    await t.click('Pay');
    expect(invoices(t)).toHaveLength(0);
    expect(lastState().status).toBe('failed');
    expect(lastState().error).toMatch(/providerToken/);
    expect(t.lastMessage!.text).toContain('status=failed');
    await t.stop();
  });

  test('API error (400 CURRENCY_TOTAL_AMOUNT_INVALID) → failed + error; retry works', async () => {
    const t = await createTestBot({ component: makeShop() });
    let fail = true;
    const orig = t.adapter.apiHandler;
    t.adapter.apiHandler = (m, p) => {
      if (m === 'sendInvoice' && fail) throw new Error('Telegram API sendInvoice failed: 400 Bad Request: CURRENCY_TOTAL_AMOUNT_INVALID');
      return orig(m, p);
    };
    const err = console.error; console.error = () => {};
    try {
      await t.send('hi');
      await t.click('Pay');
      expect(lastState().status).toBe('failed');
      expect(lastState().error).toContain('CURRENCY_TOTAL_AMOUNT_INVALID');
      fail = false;
      await t.click('Pay');
      expect(invoices(t)).toHaveLength(2);
      expect(lastState().status).toBe('pending');
    } finally { console.error = err; }
    await t.stop();
  });

  test('retry after failure clears the stale error (status pending ⇒ error null)', async () => {
    const t = await createTestBot({ component: makeShop() });
    let fail = true;
    const orig = t.adapter.apiHandler;
    t.adapter.apiHandler = (m, p) => {
      if (m === 'sendInvoice' && fail) throw new Error('boom');
      return orig(m, p);
    };
    const err = console.error; console.error = () => {};
    try {
      await t.send('hi');
      await t.click('Pay');
      fail = false;
      await t.click('Pay');
      expect(lastState().status).toBe('pending');
      expect(lastState().error).toBeNull();
    } finally { console.error = err; }
    await t.stop();
  });

  test('no platform API (adapter without api) → failed gracefully, nothing thrown', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.adapter.simulateMessage('1', '1', 'hi', { api: undefined });
    const last = t.adapter.getLastSent()!;
    const btn = JSON.stringify(last.output).match(/"callbackData":"([^"]+)"/)![1];
    await t.adapter.simulateCallback('1', '1', btn, String(last.messageId), { api: undefined, callbackLabel: 'Pay' });
    expect(lastState().status).toBe('failed');
    expect(lastState().error).toMatch(/No platform API/);
    expect(invoices(t)).toHaveLength(0);
    await t.stop();
  });

  test('double-tap Pay while an invoice is pending must not send a second payable invoice', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.send('hi');
    await t.click('Pay');
    await t.click('Pay');
    expect(invoices(t)).toHaveLength(1);
    await t.stop();
  });

  test('a DIFFERENT invoice right after a pending one is still sent (guard is per payload)', async () => {
    let payload = 'a-1';
    function Shop() {
      const inv = useInvoice({ ...BASE, payload });
      return <Message text={inv.status}><InlineKeyboard><Button text="Pay" onClick={inv.send} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: Shop });
    await t.send('hi');
    await t.click('Pay');
    payload = 'b-2';
    await t.send('switch');
    await t.click('Pay');
    expect(invoices(t).map((c) => c.params.payload)).toEqual(['a-1', 'b-2']);
    await t.stop();
  });

  test('concurrent send() calls (same tick) produce a single sendInvoice', async () => {
    function Shop() {
      const inv = useInvoice(BASE);
      return (
        <Message text={inv.status}>
          <InlineKeyboard>
            <Button text="Pay" onClick={async () => { await Promise.all([inv.send(), inv.send()]); }} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Shop });
    await t.send('hi');
    await t.click('Pay');
    expect(invoices(t)).toHaveLength(1);
    await t.stop();
  });
});

describe('useInvoice — validation before hitting the API', () => {
  const quiet = async (fn: () => Promise<void>) => { const e = console.error; console.error = () => {}; try { await fn(); } finally { console.error = e; } };

  test('non-integer amount (4.99 instead of 499) → failed locally, no API call', async () => {
    const t = await createTestBot({ component: makeShop({ prices: [{ label: 'x', amount: 4.99 }] }) });
    await quiet(async () => { await t.send('hi'); await t.click('Pay'); });
    expect(invoices(t)).toHaveLength(0);
    expect(lastState().status).toBe('failed');
    await t.stop();
  });

  test('negative total → failed locally, no API call', async () => {
    const t = await createTestBot({ component: makeShop({ prices: [{ label: 'a', amount: 100 }, { label: 'discount', amount: -500 }] }) });
    await quiet(async () => { await t.send('hi'); await t.click('Pay'); });
    expect(invoices(t)).toHaveLength(0);
    expect(lastState().status).toBe('failed');
    await t.stop();
  });

  test('payload > 128 bytes → failed locally (it is also the payment-matching key)', async () => {
    const t = await createTestBot({ component: makeShop({ payload: 'é'.repeat(65) /* 130 bytes */ }) });
    await quiet(async () => { await t.send('hi'); await t.click('Pay'); });
    expect(invoices(t)).toHaveLength(0);
    expect(lastState().status).toBe('failed');
    await t.stop();
  });

  test('suggestedTipAmounts > 4 or unsorted, or above maxTipAmount → failed locally', async () => {
    const t = await createTestBot({ component: makeShop({ maxTipAmount: 300, suggestedTipAmounts: [500, 100, 200, 300, 400] }) });
    await quiet(async () => { await t.send('hi'); await t.click('Pay'); });
    expect(invoices(t)).toHaveLength(0);
    expect(lastState().status).toBe('failed');
    await t.stop();
  });

  test('empty prices array → failed locally', async () => {
    const t = await createTestBot({ component: makeShop({ prices: [] }) });
    await quiet(async () => { await t.send('hi'); await t.click('Pay'); });
    expect(invoices(t)).toHaveLength(0);
    expect(lastState().status).toBe('failed');
    await t.stop();
  });

  test('XTR: more than one price, or tips → failed locally', async () => {
    for (const extra of [
      { prices: [{ label: 'a', amount: 1 }, { label: 'b', amount: 1 }] },
      { maxTipAmount: 10, suggestedTipAmounts: [5] },
    ]) {
      const t = await createTestBot({ component: makeShop({ currency: 'XTR', providerToken: undefined, prices: [{ label: 'x', amount: 1 }], ...extra }) });
      await quiet(async () => { await t.send('hi'); await t.click('Pay'); });
      expect(invoices(t)).toHaveLength(0);
      expect(lastState().error).toMatch(/XTR/);
      await t.stop();
    }
  });
});

describe('useInvoice — successful_payment', () => {
  test('successful_payment for THIS payload → success + receipt mapped', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.send('hi');
    await t.click('Pay');
    await deliverPayment(t, paymentRaw(1, 1, SP()));
    expect(lastState().status).toBe('success');
    expect(lastState().receipt).toEqual({
      currency: 'USD', totalAmount: 499, invoicePayload: 'premium-v1',
      telegramPaymentChargeId: 'tg_ch_1', providerPaymentChargeId: 'prov_ch_1',
      orderInfo: { name: 'Ada', email: 'ada@example.com' },
    });
    expect(t.lastMessage!.text).toContain('status=success');
    expect(t.lastMessage!.text).toContain('paid=499');
    await t.stop();
  });

  test('XTR successful_payment (no provider_payment_charge_id) → success', async () => {
    const t = await createTestBot({ component: makeShop({ currency: 'XTR', providerToken: '', prices: [{ label: 's', amount: 50 }] }) });
    await t.send('hi');
    await t.click('Pay');
    const sp = SP({ currency: 'XTR', total_amount: 50 });
    delete (sp as any).provider_payment_charge_id;
    delete (sp as any).order_info;
    await deliverPayment(t, paymentRaw(1, 1, sp));
    expect(lastState().status).toBe('success');
    expect(lastState().receipt.totalAmount).toBe(50);
    await t.stop();
  });

  test('successful_payment for a DIFFERENT payload does not mark success', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.send('hi');
    await t.click('Pay');
    await deliverPayment(t, paymentRaw(1, 1, SP({ invoice_payload: 'other-product' })));
    expect(lastState().status).toBe('pending');
    expect(lastState().receipt).toBeNull();
    await t.stop();
  });

  test('payment arriving after a restart (fresh root) is still recognised by the screen', async () => {
    const Shop = makeShop();
    const t1 = await createTestBot({ component: Shop });
    await t1.send('hi');
    await t1.click('Pay');
    await t1.stop();
    // "Restart": a brand-new bot instance sees only the payment message.
    const t2 = await createTestBot({ component: Shop });
    await deliverPayment(t2, paymentRaw(1, 1, SP()));
    expect(t2.adapter.sent.length).toBeGreaterThan(0);
    expect(lastState().status).toBe('success');
    expect(t2.lastMessage!.text).toContain('status=success');
    await t2.stop();
  });

  test('duplicate successful_payment delivery (same update_id) fires user useOn handler once', async () => {
    let grants = 0;
    function Shop() {
      const inv = useInvoice(BASE);
      useOn('successful_payment', () => { grants++; });
      return <Message text={inv.status}><InlineKeyboard><Button text="Pay" onClick={inv.send} /></InlineKeyboard></Message>;
    }
    const t = await createTestBot({ component: Shop });
    await t.send('hi');
    await t.click('Pay');
    const raw = paymentRaw(1, 1, SP());
    await deliverPayment(t, raw);
    await deliverPayment(t, raw);
    expect(grants).toBe(1);
    expect(t.lastMessage!.text).toBe('success');
    await t.stop();
  });

  test('later unrelated updates keep status=success (no regression)', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.send('hi');
    await t.click('Pay');
    await deliverPayment(t, paymentRaw(1, 1, SP()));
    await t.send('hello again');
    expect(lastState().status).toBe('success');
    await t.stop();
  });

  test('send again after success → new invoice, stale receipt cleared while pending', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.send('hi');
    await t.click('Pay');
    await deliverPayment(t, paymentRaw(1, 1, SP()));
    await t.click('Pay');
    expect(invoices(t)).toHaveLength(2);
    expect(lastState().status).toBe('pending');
    expect(lastState().receipt).toBeNull();
    await t.stop();
  });

  test('group chat: successful_payment in the group marks the group screen paid', async () => {
    const t = await createTestBot({ component: makeShop(), chatId: '-300', userId: '5' });
    await t.send('hi');
    await t.click('Pay');
    await deliverPayment(t, paymentRaw(-300, 5, SP()), '-300', '5');
    expect(lastState().status).toBe('success');
    await t.stop();
  });

  test('pre_checkout_query event does not spawn a screen in a chat without live UI', async () => {
    const t = await createTestBot({ component: makeShop() });
    await t.event('pre_checkout_query', { pre_checkout_query: { id: 'pcq', from: { id: 1 }, currency: 'USD', total_amount: 499, invoice_payload: 'premium-v1' } });
    expect(t.adapter.sent).toHaveLength(0);
    await t.stop();
  });

  test.todo('payment state lost on restart if the screen is not mounted: status/receipt live in useState only — persist via session or expose an onSuccess callback', () => {});
  test('reset() returns to idle and allows an immediate re-send (user closed the invoice)', async () => {
    let inv!: ReturnType<typeof useInvoice>;
    function Shop() {
      inv = useInvoice(BASE);
      return (
        <Message text={`status=${inv.status}`}>
          <InlineKeyboard>
            <Button text="Pay" onClick={inv.send} />
            <Button text="Cancel" onClick={inv.reset} />
          </InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Shop });
    await t.send('hi');
    await t.click('Pay');
    await t.click('Cancel');
    expect(t.lastMessage!.text).toBe('status=idle');
    await t.click('Pay');
    expect(invoices(t)).toHaveLength(2);
    await t.stop();
  });
});

// ───────────────────── adapter-level: Telegram ─────────────────────

const TOKEN = '123:FAKE';
const ME = { id: 999, is_bot: true, first_name: 'Teact', username: 'teact_bot' };

function fakeTelegram(opts: { fail?: (method: string, params: any) => any } = {}) {
  const calls: { method: string; params: any }[] = [];
  let nextMessageId = 500;
  const fetchImpl = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = url.split('/').pop()!.split('?')[0];
    const params = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method, params });
    const failure = opts.fail?.(method, params);
    if (failure) return new Response(JSON.stringify({ ok: false, ...failure }), { headers: { 'content-type': 'application/json' } });
    let result: any = true;
    if (method === 'getMe') result = ME;
    else if (method.startsWith('send')) result = { message_id: nextMessageId++, date: 0, chat: { id: params.chat_id, type: 'private' } };
    else if (method.startsWith('edit')) result = { message_id: params.message_id, date: 0, chat: { id: params.chat_id, type: 'private' } };
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl, of: (m: string) => calls.filter((c) => c.method === m) };
}

let tgUpd = 1;
const tgUser = { id: 42, is_bot: false, first_name: 'Ada' };
const tgChat = { id: 42, type: 'private' as const, first_name: 'Ada' };
const post = (body: unknown) =>
  new Request('https://bot.example/webhook', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const textU = (text: string) => ({ update_id: tgUpd++, message: { message_id: tgUpd + 1000, date: 0, chat: tgChat, from: tgUser, text } });
const cbU = (data: string, messageId: number) => ({
  update_id: tgUpd++,
  callback_query: { id: `q${tgUpd}`, from: tgUser, chat_instance: 'ci', data, message: { message_id: messageId, date: 0, chat: tgChat, from: ME, text: 'x' } },
});
const pcqU = (over: Record<string, unknown> = {}) => ({
  update_id: tgUpd++,
  pre_checkout_query: { id: `pcq${tgUpd}`, from: tgUser, currency: 'USD', total_amount: 499, invoice_payload: 'premium-v1', ...over },
});
const shipU = () => ({
  update_id: tgUpd++,
  shipping_query: { id: `sq${tgUpd}`, from: tgUser, invoice_payload: 'premium-v1', shipping_address: { country_code: 'US', state: '', city: 'NYC', street_line1: 'x', street_line2: '', post_code: '1' } },
});
const spU = (sp: Record<string, unknown>) => ({
  update_id: tgUpd++,
  message: { message_id: tgUpd + 1000, date: 0, chat: tgChat, from: tgUser, successful_payment: sp },
});

function tgBot(cfg: Partial<TelegramAdapterConfig> = {}, component: React.FC = makeShop(), tgOpts: Parameters<typeof fakeTelegram>[0] = {}) {
  const tg = fakeTelegram(tgOpts);
  const adapter = new TelegramAdapter({ driver: fetchDriver({ fetch: tg.fetch, maxRetries: 0 }), ...cfg });
  const bot = createBot({ adapter, component, commands: { start: { description: 'Start' } } });
  return { tg, adapter, bot, send: (u: unknown) => bot.fetch(post(u), { token: TOKEN }) };
}

const realError = console.error;
afterEach(() => { console.error = realError; });

describe('TelegramAdapter — pre_checkout_query', () => {
  test('default: approves (ok: true) and nothing else', async () => {
    const { tg, bot, send } = tgBot();
    await send(pcqU());
    const [a] = tg.of('answerPreCheckoutQuery');
    expect(a.params).toEqual({ pre_checkout_query_id: expect.stringMatching(/^pcq/), ok: true });
    await bot.stop();
  });

  test('onPreCheckout returning a string declines with that error_message', async () => {
    const { tg, bot, send } = tgBot({ onPreCheckout: () => 'Sold out' });
    await send(pcqU());
    expect(tg.of('answerPreCheckoutQuery')[0].params).toMatchObject({ ok: false, error_message: 'Sold out' });
    await bot.stop();
  });

  test('onPreCheckout receives the query (payload, amount, currency)', async () => {
    let got: any;
    const { bot, send } = tgBot({ onPreCheckout: (q) => { got = q; return true; } });
    await send(pcqU({ invoice_payload: 'order-7', total_amount: 1234 }));
    expect(got).toMatchObject({ invoice_payload: 'order-7', total_amount: 1234, currency: 'USD' });
    await bot.stop();
  });

  test('onPreCheckout throwing → declines with a generic message (never unanswered)', async () => {
    console.error = () => {};
    const { tg, bot, send } = tgBot({ onPreCheckout: () => { throw new Error('db down'); } });
    await send(pcqU());
    const [a] = tg.of('answerPreCheckoutQuery');
    expect(a.params.ok).toBe(false);
    expect(typeof a.params.error_message).toBe('string');
    expect(a.params.error_message.length).toBeGreaterThan(0);
    expect(a.params.error_message).not.toContain('db down');
    await bot.stop();
  });

  test('async onPreCheckout rejecting → declines', async () => {
    console.error = () => {};
    const { tg, bot, send } = tgBot({ onPreCheckout: async () => { throw new Error('x'); } });
    await send(pcqU());
    expect(tg.of('answerPreCheckoutQuery')[0].params.ok).toBe(false);
    await bot.stop();
  });

  test('onPreCheckout returning undefined (forgot `return`) still sends a VALID answer', async () => {
    const { tg, bot, send } = tgBot({ onPreCheckout: (() => { /* no return */ }) as any });
    await send(pcqU());
    const [a] = tg.of('answerPreCheckoutQuery');
    // Telegram requires error_message when ok=false; a decline without it is rejected → query hangs.
    if (a.params.ok === false) expect(typeof a.params.error_message).toBe('string');
    else expect(a.params.ok).toBe(true);
    await bot.stop();
  });

  test('onPreCheckout returning "" (empty decline) still sends a VALID answer with a non-empty error_message', async () => {
    const { tg, bot, send } = tgBot({ onPreCheckout: () => '' });
    await send(pcqU());
    const [a] = tg.of('answerPreCheckoutQuery');
    expect(a.params.ok).toBe(false);
    expect(typeof a.params.error_message).toBe('string');
    expect(a.params.error_message.length).toBeGreaterThan(0);
    await bot.stop();
  });

  test('onPreCheckout returning false declines with a valid error_message', async () => {
    const { tg, bot, send } = tgBot({ onPreCheckout: (() => false) as any });
    await send(pcqU());
    const [a] = tg.of('answerPreCheckoutQuery');
    expect(a.params.ok).toBe(false);
    expect(typeof a.params.error_message).toBe('string');
    await bot.stop();
  });

  test('a throwing raw `update` listener must not leave the pre_checkout_query unanswered', async () => {
    console.error = () => {};
    const { tg, adapter, bot, send } = tgBot();
    adapter.on('update', (() => { throw new Error('analytics listener crashed'); }) as any);
    await send(pcqU());
    expect(tg.of('answerPreCheckoutQuery')).toHaveLength(1);
    await bot.stop();
  });

  test('slow onPreCheckout (hangs) is still answered (declined) before Telegram\'s 10s deadline', async () => {
    console.error = () => {};
    const { tg, bot, send } = tgBot({ onPreCheckout: () => new Promise<true>(() => {}) });
    void send(pcqU());
    await new Promise((r) => setTimeout(r, 9_500));
    expect(tg.of('answerPreCheckoutQuery')).toHaveLength(1);
    await bot.stop().catch(() => {});
  }, 12_000);

  test('pre_checkout_query is answered even when the bot has no live UI for the user', async () => {
    const { tg, bot, send } = tgBot();
    await send(pcqU());
    expect(tg.of('answerPreCheckoutQuery')).toHaveLength(1);
    expect(tg.of('sendMessage')).toHaveLength(0);
    await bot.stop();
  });

  test('pre_checkout_query with a live UI does not send/edit a message in the user\'s chat', async () => {
    const { tg, bot, send } = tgBot();
    await send(textU('/start'));
    const before = tg.calls.filter((c) => c.method.startsWith('send') || c.method.startsWith('edit')).length;
    await send(pcqU());
    const after = tg.calls.filter((c) => c.method.startsWith('send') || c.method.startsWith('edit')).length;
    expect(after).toBe(before);
    expect(tg.of('answerPreCheckoutQuery')).toHaveLength(1);
    await bot.stop();
  });

  test('pre_checkout for an unknown payload: default approves (documented); onPreCheckout can reject', async () => {
    const known = new Set(['premium-v1']);
    const { tg, bot, send } = tgBot({ onPreCheckout: (q) => known.has(q.invoice_payload) || 'Unknown item' });
    await send(pcqU({ invoice_payload: 'ghost' }));
    expect(tg.of('answerPreCheckoutQuery')[0].params).toMatchObject({ ok: false, error_message: 'Unknown item' });
    await bot.stop();
  });

  test.todo('default approve-all accepts payloads/amounts the app never issued — consider verifying against invoices sent by useInvoice or requiring onPreCheckout when payments are used', () => {});
  test.todo('onPreCheckout has no access to session/bot context (only the raw query) — hard to check stock/user state', () => {});
});

describe('TelegramAdapter — shipping_query (is_flexible invoices)', () => {
  test('shipping_query is answered (otherwise flexible invoices hang at checkout)', async () => {
    const { tg, bot, send } = tgBot();
    await send(shipU());
    expect(tg.of('answerShippingQuery')).toHaveLength(1);
    await bot.stop();
  });
  test('onShippingQuery options are sent; a string declines', async () => {
    const opts = [{ id: 'std', title: 'Standard', prices: [{ label: 'Ship', amount: 300 }] }];
    const a = tgBot({ onShippingQuery: () => opts });
    await a.send(shipU());
    expect(a.tg.of('answerShippingQuery')[0].params).toMatchObject({ ok: true, shipping_options: opts });
    await a.bot.stop();
    const b = tgBot({ onShippingQuery: () => 'No shipping to Mars' });
    await b.send(shipU());
    expect(b.tg.of('answerShippingQuery')[0].params).toMatchObject({ ok: false, error_message: 'No shipping to Mars' });
    await b.bot.stop();
  });
});

describe('TelegramAdapter — end-to-end payment flow', () => {
  test('Pay → sendInvoice (serialized prices) → pre_checkout approved → successful_payment marks screen paid', async () => {
    const { tg, bot, send } = tgBot();
    await send(textU('/start'));
    const [sent] = tg.of('sendMessage');
    const pay = sent.params.reply_markup.inline_keyboard[0][0];
    await send(cbU(pay.callback_data, 500));
    const [inv] = tg.of('sendInvoice');
    expect(inv.params).toMatchObject({ chat_id: '42', payload: 'premium-v1', currency: 'USD', prices: [{ label: 'Premium', amount: 499 }], provider_token: 'prov_tok' });
    await send(pcqU());
    expect(tg.of('answerPreCheckoutQuery')[0].params.ok).toBe(true);
    await send(spU(SP()));
    const texts = [...tg.of('sendMessage'), ...tg.of('editMessageText')].map((c) => c.params.text);
    expect(texts.at(-1)).toContain('status=success');
    await bot.stop();
  });

  test('sendInvoice 400 from Telegram surfaces as status=failed with the description', async () => {
    console.error = () => {};
    const { tg, bot, send } = tgBot({}, makeShop(), {
      fail: (m) => m === 'sendInvoice' ? { error_code: 400, description: 'Bad Request: CURRENCY_TOTAL_AMOUNT_INVALID' } : null,
    });
    await send(textU('/start'));
    const pay = tg.of('sendMessage')[0].params.reply_markup.inline_keyboard[0][0];
    await send(cbU(pay.callback_data, 500));
    const texts = [...tg.of('sendMessage'), ...tg.of('editMessageText')].map((c) => c.params.text);
    expect(texts.at(-1)).toContain('status=failed');
    expect(texts.at(-1)).toContain('CURRENCY_TOTAL_AMOUNT_INVALID');
    await bot.stop();
  });
});

describe('feature gaps', () => {
  test.todo('no refundStarPayment helper (only untyped api.refundStarPayment / api.call)', () => {});
  test.todo('no createInvoiceLink support (needed for Stars subscriptions via subscription_period, inline/web-app checkout)', () => {});
  test.todo('InvoiceConfig lacks reply_markup (custom Pay button), disable_notification, reply_parameters, message_effect_id, business_connection_id', () => {});
  test.todo('no getStarTransactions / refunded_payment (message.refunded_payment) handling', () => {});
});
