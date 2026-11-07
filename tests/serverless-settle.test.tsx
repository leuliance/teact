import { describe, test, expect, afterAll } from 'bun:test';
import React, { useEffect, useState } from 'react';
import { createBot, useQuery } from '../packages/core/src';
import { Message, InlineKeyboard, Button } from '../packages/ui/src';
import { MockAdapter, createTestBot } from '../packages/testing/src';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (body: unknown) => new Request('https://x/', { method: 'POST', body: JSON.stringify(body) });

// A slow upstream API served locally, so third-party-style `fetch` calls are real.
const server = Bun.serve({ port: 0, fetch: async () => { await sleep(400); return Response.json({ name: 'pikachu' }); } });
afterAll(() => server.stop(true));

let slowKey = 0;
function Slow() {
  const [key] = useState(() => `slow-${++slowKey}`); // fresh cache entry per bot
  const q = useQuery({ key, fn: async () => { await sleep(400); return 'data!'; } });
  return <Message text={q.data ?? 'Loading…'} />;
}

/** Fetches with plain `fetch` in an effect, like TanStack Query / supabase-js would. */
function ThirdParty() {
  const [name, setName] = useState<string>();
  useEffect(() => { fetch(server.url).then((r) => r.json()).then((j: any) => setName(j.name)); }, []);
  return <Message text={name ?? 'Loading…'} />;
}

describe('serverless settling (bot.fetch)', () => {
  test('without waitUntil, the response waits until the data has rendered', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ adapter, component: Slow, token: 't' });
    await bot.fetch(post({ text: 'hi' }));
    expect(adapter.getLastEdited()?.output.props.text ?? adapter.getLastSent()?.output.props.text).toBe('data!');
    await bot.stop();
  });

  test('with waitUntil, the response is immediate and work finishes in the background', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ adapter, component: Slow, token: 't' });
    const pending: Promise<unknown>[] = [];
    const t = Date.now();
    await bot.fetch(post({ text: 'hi' }), { waitUntil: (p) => pending.push(p) });
    expect(Date.now() - t).toBeLessThan(300);
    expect(adapter.getLastSent()?.output.props.text).toBe('Loading…');
    await Promise.all(pending);
    expect(adapter.getLastEdited()?.output.props.text).toBe('data!');
    await bot.stop();
  });

  test('third-party fetch calls are waited for', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ adapter, component: ThirdParty, token: 't' });
    await bot.fetch(post({ text: 'hi' }));
    expect(adapter.getLastEdited()?.output.props.text).toBe('pikachu');
    await bot.stop();
  });

  test('settle: false returns right after the first render', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ adapter, component: Slow, token: 't' });
    await bot.fetch(post({ text: 'hi' }), { settle: false });
    expect(adapter.edited).toHaveLength(0);
    await bot.stop();
  });
});

describe('useQuery timeout & abort', () => {
  test('a hung request times out into an error, and its signal is aborted', async () => {
    let signal: AbortSignal | undefined;
    function Hung() {
      const q = useQuery({ key: 'hung', timeout: 150, fn: ({ signal: s }) => { signal = s; return new Promise<string>(() => {}); } });
      return <Message text={q.isError ? `error: ${q.error!.message}` : q.data ?? 'Loading…'} />;
    }
    const t = await createTestBot({ component: Hung });
    await t.send('hi');
    await sleep(300);
    expect(t.lastMessage?.text).toBe('error: Request timed out after 0.2s');
    expect(signal?.aborted).toBe(true);
    await t.stop();
  });

  test('changing the key aborts the superseded request', async () => {
    const signals: AbortSignal[] = [];
    function Paged() {
      const [page, setPage] = useState(1);
      const q = useQuery({ key: `page-${page}`, fn: async ({ signal }) => { signals.push(signal); await sleep(200); return `page ${page}`; } });
      return (
        <Message text={q.data ?? 'Loading…'}>
          <InlineKeyboard><Button text="next" onClick={() => setPage((p) => p + 1)} /></InlineKeyboard>
        </Message>
      );
    }
    const t = await createTestBot({ component: Paged });
    await t.send('hi');
    await t.click('next'); // before page 1 resolved
    await sleep(400);
    expect(signals[0].aborted).toBe(true);
    expect(t.lastMessage?.text).toBe('page 2');
    await t.stop();
  });
});
