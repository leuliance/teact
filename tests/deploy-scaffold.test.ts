import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { deployCommand } from '../packages/cli/src/commands/deploy';

const REPO = join(import.meta.dir, '..');
const cwd = process.cwd();
const savedToken = process.env.TELEGRAM_BOT_TOKEN;
afterEach(() => {
  process.chdir(cwd);
  if (savedToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = savedToken;
});

/** A minimal Teact project whose bot runs on the MockAdapter (no network). */
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teact-deploy-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@me/My_Bot', dependencies: { '@teactjs/core': '*' } }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/index.ts'), `
    import React from '${REPO}/node_modules/react';
    import { createBot } from '${REPO}/packages/core/src';
    import { MockAdapter } from '${REPO}/packages/testing/src';
    export const adapter = new MockAdapter();
    export const bot = createBot({ adapter, component: () => React.createElement('tg-message', { text: 'deployed ok' }) });
    if (import.meta.main) bot.start();
  `);
  return dir;
}

const webhookRequest = () => new Request('https://example.com/api', { method: 'POST', body: JSON.stringify({ text: 'hi' }) });

describe('teact deploy scaffolds working entries', () => {
  test('vercel: api/telegram.ts exports a POST handler that serves the bot', async () => {
    const dir = makeProject();
    process.chdir(dir);
    await deployCommand('vercel', {});
    const src = readFileSync(join(dir, 'api/telegram.ts'), 'utf-8');
    expect(src).toContain('export function POST(request: Request)');
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const fn = await import(join(dir, 'api/telegram.ts'));
    const { adapter } = await import(join(dir, 'src/index.ts'));
    const res: Response = await fn.POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(adapter.getLastSent()?.output.props.text).toBe('deployed ok');
  });

  test('cloudflare: src/worker.ts + wrangler.jsonc with a valid Worker name', async () => {
    const dir = makeProject();
    process.chdir(dir);
    await deployCommand('cloudflare', {});
    expect(existsSync(join(dir, 'src/worker.ts'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'wrangler.jsonc'), 'utf-8')).name).toBe('me-my-bot');
    const worker = (await import(join(dir, 'src/worker.ts'))).default;
    const { adapter } = await import(join(dir, 'src/index.ts'));
    const res: Response = await worker.fetch(webhookRequest(), { TELEGRAM_BOT_TOKEN: 'test-token' });
    expect(res.status).toBe(200);
    expect(adapter.getLastSent()?.output.props.text).toBe('deployed ok');
  });
});
