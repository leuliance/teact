import { describe, test, expect } from 'bun:test';
import React, { useState } from 'react';
import { createRoot, type OutputNode } from '../packages/renderer/src';
import { RuntimeContext, type RuntimeContextValue } from '../packages/runtime/src/context';
import { useOn, useEventData, type TelegramEvent } from '../packages/runtime/src/event-hooks';
import { RouterCtx, CommitModeCtx, type CommitModeRef } from '../packages/runtime/src/router';
import type { BotContext } from '../packages/renderer/src';

const waitForCommit = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

/** useOn handlers run in useEffect; a fixed delay is flaky under load. */
async function waitForCondition(
  predicate: () => boolean,
  opts: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 3000;
  const interval = opts.interval ?? 15;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout after ${timeout}ms waiting for async hook effect`);
}

function makeBotCtx(overrides: Partial<BotContext> = {}): BotContext {
  return {
    chatId: '123',
    userId: '456',
    user: { id: '456', username: 'testuser', firstName: 'Test', platform: 'telegram' },
    platform: 'telegram',
    raw: null,
    ...overrides,
  };
}

function makeRuntimeValue(botCtx: BotContext): RuntimeContextValue {
  return {
    botCtx,
    session: {},
    updateSession: () => {},
    command: null,
  };
}

function wrapWithProviders(element: React.ReactElement, botCtx: BotContext): React.ReactElement {
  const commitMode: CommitModeRef = { current: 'replace' };
  const routerValue = { path: '/', params: {}, navigate: () => {} };
  return React.createElement(
    CommitModeCtx.Provider, { value: commitMode },
    React.createElement(
      RouterCtx.Provider, { value: routerValue },
      React.createElement(
        RuntimeContext.Provider, { value: makeRuntimeValue(botCtx) },
        element,
      ),
    ),
  );
}

describe('TelegramEvent type', () => {
  test('includes all expected event types', () => {
    const events: TelegramEvent[] = [
      '*', 'message', 'text', 'photo', 'video', 'audio', 'voice',
      'document', 'sticker', 'contact', 'location', 'venue',
      'animation', 'video_note', 'poll', 'poll_answer',
      'callback_query', 'inline_query',
      'new_chat_members', 'left_chat_member',
      'dice', 'game', 'web_app_data',
      'successful_payment', 'pre_checkout_query',
    ];
    expect(events).toHaveLength(25);
    events.forEach(e => expect(typeof e).toBe('string'));
  });
});

describe('useEventData', () => {
  test('returns null when no raw data', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('photo');
      return React.createElement('tg-message', { text: 'test' });
    }

    const botCtx = makeBotCtx({ raw: null });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toBeNull();
  });

  test('extracts photo data from raw message', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('photo');
      return React.createElement('tg-message', { text: 'test' });
    }

    const photoPayload = [{ file_id: 'abc', width: 100, height: 100 }];
    const botCtx = makeBotCtx({
      raw: { message: { photo: photoPayload, message_id: 1 } },
    });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toEqual(photoPayload);
  });

  test('extracts contact data from raw message', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('contact');
      return React.createElement('tg-message', { text: 'test' });
    }

    const contactPayload = { phone_number: '+1234567890', first_name: 'Alice' };
    const botCtx = makeBotCtx({
      raw: { message: { contact: contactPayload, message_id: 2 } },
    });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toEqual(contactPayload);
  });

  test('extracts text message data', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('text');
      return React.createElement('tg-message', { text: 'test' });
    }

    const msg = { text: 'hello world', message_id: 3 };
    const botCtx = makeBotCtx({ raw: { message: msg } });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toEqual(msg);
    expect(result.text).toBe('hello world');
  });

  test('returns null for non-matching event type', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('video');
      return React.createElement('tg-message', { text: 'test' });
    }

    const botCtx = makeBotCtx({
      raw: { message: { text: 'hello', message_id: 4 } },
    });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toBeNull();
  });

  test('extracts callback_query data', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('callback_query');
      return React.createElement('tg-message', { text: 'test' });
    }

    const cbQuery = { id: 'cb1', data: 'action' };
    const botCtx = makeBotCtx({ raw: { callbackQuery: cbQuery } });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toEqual(cbQuery);
  });

  test('extracts location data', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('location');
      return React.createElement('tg-message', { text: 'test' });
    }

    const loc = { latitude: 9.02, longitude: 38.75 };
    const botCtx = makeBotCtx({
      raw: { message: { location: loc, message_id: 5 } },
    });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toEqual(loc);
  });

  test('extracts document data', async () => {
    let result: any = 'unset';
    function TestComp() {
      result = useEventData('document');
      return React.createElement('tg-message', { text: 'test' });
    }

    const doc = { file_id: 'doc1', file_name: 'readme.pdf' };
    const botCtx = makeBotCtx({
      raw: { message: { document: doc, message_id: 6 } },
    });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(result).toEqual(doc);
  });
});

describe('useOn', () => {
  test('wildcard handler receives raw data', async () => {
    let captured: any = null;
    function TestComp() {
      useOn('*', (data) => { captured = data; });
      return React.createElement('tg-message', { text: 'test' });
    }

    const rawUpdate = { update: { update_id: 100 }, message: { text: 'hi', message_id: 10 } };
    const botCtx = makeBotCtx({ raw: rawUpdate });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCondition(() => captured !== null);
    expect(captured).toEqual(rawUpdate);
  });

  test('photo handler fires with photo data', async () => {
    let captured: any = null;
    function TestComp() {
      useOn('photo', (data) => { captured = data; });
      return React.createElement('tg-message', { text: 'test' });
    }

    const photoData = [{ file_id: 'photo1', width: 200, height: 200 }];
    const rawUpdate = { update: { update_id: 101 }, message: { photo: photoData, message_id: 11 } };
    const botCtx = makeBotCtx({ raw: rawUpdate });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCondition(() => captured !== null);
    expect(captured).toEqual(photoData);
  });

  test('contact handler fires with contact data', async () => {
    let captured: any = null;
    function TestComp() {
      useOn('contact', (data) => { captured = data; });
      return React.createElement('tg-message', { text: 'test' });
    }

    const contactData = { phone_number: '+9876543210', first_name: 'Bob' };
    const rawUpdate = { update: { update_id: 102 }, message: { contact: contactData, message_id: 12 } };
    const botCtx = makeBotCtx({ raw: rawUpdate });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCondition(() => captured !== null);
    expect(captured).toEqual(contactData);
  });

  test('handler receives EventContext with chatId and userId', async () => {
    let capturedCtx: any = null;
    function TestComp() {
      useOn('*', (_data, ctx) => { capturedCtx = ctx; });
      return React.createElement('tg-message', { text: 'test' });
    }

    const rawUpdate = { update: { update_id: 103 }, message: { text: 'hi', message_id: 13 } };
    const botCtx = makeBotCtx({ raw: rawUpdate, chatId: '999', userId: '888' });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCondition(() => capturedCtx !== null);
    expect(capturedCtx.chatId).toBe('999');
    expect(capturedCtx.userId).toBe('888');
  });

  test('handler does not fire for non-matching event', async () => {
    let fired = false;
    function TestComp() {
      useOn('sticker', () => { fired = true; });
      return React.createElement('tg-message', { text: 'test' });
    }

    const rawUpdate = { update: { update_id: 104 }, message: { text: 'just text', message_id: 14 } };
    const botCtx = makeBotCtx({ raw: rawUpdate });
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(wrapWithProviders(React.createElement(TestComp), botCtx));
    await waitForCommit();
    expect(fired).toBe(false);
  });
});
