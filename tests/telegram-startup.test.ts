import { test, expect } from 'bun:test';
import { TelegramAdapter } from '../packages/telegram/src';

test('listen() rejects quickly when Telegram is unreachable (no silent hang)', async () => {
  // Port 9 (discard) on localhost: connection refused immediately.
  const adapter = new TelegramAdapter({ client: { apiRoot: 'http://127.0.0.1:9' } });
  await adapter.connect({ token: '123456:TEST' });
  const started = Date.now();
  await expect(adapter.listen({ polling: true })).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(5000);
  await adapter.disconnect();
});
