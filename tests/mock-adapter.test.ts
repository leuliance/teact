import { describe, test, expect } from 'bun:test';
import { MockAdapter } from '../packages/testing/src/mock-adapter';

describe('MockAdapter', () => {
  test('connects and disconnects', async () => {
    const adapter = new MockAdapter();
    await adapter.connect();
    expect(adapter.connected).toBe(true);
    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
  });

  test('records sent messages', async () => {
    const adapter = new MockAdapter();
    const output = { type: 'tg-message' as const, props: { text: 'hi' }, children: [] };

    const id = await adapter.send('123', output);
    expect(id).toBe(1);
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].output.props.text).toBe('hi');
  });

  test('records edited messages', async () => {
    const adapter = new MockAdapter();
    const output = { type: 'tg-message' as const, props: { text: 'updated' }, children: [] };

    await adapter.edit('123', 1, output);
    expect(adapter.edited).toHaveLength(1);
  });

  test('simulates message events', () => {
    const adapter = new MockAdapter();
    let received: any = null;

    adapter.on('message', (ctx) => { received = ctx; });
    adapter.simulateMessage('chat1', 'user1', 'hello');

    expect(received).not.toBeNull();
    expect(received.chatId).toBe('chat1');
    expect(received.text).toBe('hello');
    expect(received.platform).toBe('mock');
  });

  test('simulates callback events', () => {
    const adapter = new MockAdapter();
    let received: any = null;

    adapter.on('callback_query', (ctx) => { received = ctx; });
    adapter.simulateCallback('chat1', 'user1', 'btn_click');

    expect(received.callbackData).toBe('btn_click');
  });

  test('resets state', async () => {
    const adapter = new MockAdapter();
    await adapter.send('1', { type: 'tg-message', props: {}, children: [] });
    await adapter.edit('1', 1, { type: 'tg-message', props: {}, children: [] });

    adapter.reset();
    expect(adapter.sent).toHaveLength(0);
    expect(adapter.edited).toHaveLength(0);
  });
});
