import { describe, test, expect } from 'bun:test';
import type { OutputNode } from '../packages/core/src';
import { MockAdapter } from '../packages/testing/src';
import { createBroadcaster, type BroadcastProgress } from '../packages/plugins/src';

function apiError(code: number, description: string, retryAfter?: number) {
  return Object.assign(new Error(`Call to 'sendMessage' failed! (${code}: ${description})`), {
    error_code: code,
    description,
    parameters: retryAfter != null ? { retry_after: retryAfter } : undefined,
  });
}

describe('createBroadcaster', () => {
  test('delivers to every recipient and paces sends to the rate', async () => {
    const adapter = new MockAdapter();
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    const progress: BroadcastProgress[] = [];
    const b = createBroadcaster({ adapter, recipients: () => ids, rate: 100, onProgress: (p) => progress.push(p) });
    const result = await b.send('hello');
    expect(result).toMatchObject({ total: 10, sent: 10, blocked: [], failed: [], aborted: false });
    expect(adapter.sent.map((s) => s.chatId)).toEqual(ids);
    expect(adapter.sent[0].output).toEqual({ type: 'tg-message', props: { text: 'hello' }, children: [] });
    // 10 sends at 100/s → first send immediate, last ≥ ~90ms later.
    const span = adapter.sent.at(-1)!.timestamp - adapter.sent[0].timestamp;
    expect(span).toBeGreaterThanOrEqual(80);
    expect(progress.at(-1)).toEqual({ processed: 10, sent: 10, failed: 0, blocked: 0 });
  });

  test('accepts async iterables and per-chat message builders / OutputNodes', async () => {
    const adapter = new MockAdapter();
    async function* recipients() { yield 'a'; yield 'b'; }
    const node: OutputNode = { type: 'tg-message', props: { text: 'node' }, children: [] };
    const r1 = await createBroadcaster({ adapter, recipients, rate: 1000 }).send((id) => `hi ${id}`);
    const r2 = await createBroadcaster({ adapter, recipients, rate: 1000 }).send(node);
    expect(r1.sent + r2.sent).toBe(4);
    expect(adapter.sent.map((s) => s.output.props.text)).toEqual(['hi a', 'hi b', 'node', 'node']);
  });

  test('collects 403 (blocked) separately and other errors as failures', async () => {
    const adapter = new MockAdapter();
    const orig = adapter.send.bind(adapter);
    adapter.send = async (chatId, output) => {
      if (chatId === 2) throw apiError(403, 'Forbidden: bot was blocked by the user');
      if (chatId === 3) throw apiError(400, 'Bad Request: chat not found');
      return orig(chatId, output);
    };
    const result = await createBroadcaster({ adapter, recipients: () => [1, 2, 3, 4], rate: 1000 }).send('x');
    expect(result.sent).toBe(2);
    expect(result.blocked).toEqual([2]);
    expect(result.failed.map((f) => f.chatId)).toEqual([3]);
    expect((result.failed[0].error as any).error_code).toBe(400);
  });

  test('honours 429 retry_after and retries', async () => {
    const adapter = new MockAdapter();
    const orig = adapter.send.bind(adapter);
    let throttled = false;
    let throttledAt = 0;
    adapter.send = async (chatId, output) => {
      if (chatId === 2 && !throttled) {
        throttled = true;
        throttledAt = Date.now();
        throw Object.assign(apiError(429, 'Too Many Requests'), { parameters: { retry_after: 0.05 } });
      }
      return orig(chatId, output);
    };
    const result = await createBroadcaster({ adapter, recipients: () => [1, 2, 3], rate: 1000, concurrency: 1 }).send('x');
    expect(result.sent).toBe(3);
    expect(result.failed).toEqual([]);
    const retried = adapter.sent.find((s) => s.chatId === 2)!;
    expect(retried.timestamp - throttledAt).toBeGreaterThanOrEqual(45);
  });

  test('gives up after maxRetries', async () => {
    const adapter = new MockAdapter();
    let calls = 0;
    adapter.send = async () => { calls++; throw Object.assign(apiError(429, 'Too Many Requests'), { parameters: { retry_after: 0.001 } }); };
    const result = await createBroadcaster({ adapter, recipients: () => [1], rate: 1000, maxRetries: 2 }).send('x');
    expect(calls).toBe(3);
    expect(result.failed.length).toBe(1);
  });

  test('abort signal stops early', async () => {
    const adapter = new MockAdapter();
    const controller = new AbortController();
    const b = createBroadcaster({
      adapter,
      recipients: () => Array.from({ length: 50 }, (_, i) => i),
      rate: 200,
      onProgress: (p) => { if (p.processed === 3) controller.abort(); },
    });
    const result = await b.send('x', { signal: controller.signal });
    expect(result.aborted).toBe(true);
    expect(result.total).toBeLessThan(50);
    expect(result.sent).toBe(result.total);
  });

  test('rejects invalid rate', () => {
    expect(() => createBroadcaster({ adapter: new MockAdapter(), recipients: () => [], rate: 0 })).toThrow();
  });
});
