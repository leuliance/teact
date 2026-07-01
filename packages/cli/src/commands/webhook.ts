import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { heading, log, error, success, findProjectRoot } from '../utils';

function readToken(projectRoot: string): string | undefined {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf-8').match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

async function callApi(token: string, method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json() as Promise<{ ok: boolean; result?: any; description?: string }>;
}

interface WebhookOptions {
  secret?: string;
  drop?: boolean;
}

/**
 * Manage the Telegram webhook: `teact webhook set <url>`, `delete`, or `info`.
 * Uses TELEGRAM_BOT_TOKEN from the environment or the project's .env.
 */
export async function webhookCommand(action: string, url: string | undefined, opts: WebhookOptions): Promise<void> {
  const projectRoot = findProjectRoot() ?? process.cwd();
  const token = readToken(projectRoot);
  if (!token) {
    error('No TELEGRAM_BOT_TOKEN found (checked env and .env).');
    process.exit(1);
  }

  heading(`Telegram webhook — ${action}`);

  try {
    if (action === 'set') {
      if (!url) { error('Usage: teact webhook set <https-url> [--secret <token>]'); process.exit(1); }
      const body: Record<string, unknown> = { url };
      if (opts.secret) body.secret_token = opts.secret;
      if (opts.drop) body.drop_pending_updates = true;
      const r = await callApi(token, 'setWebhook', body);
      if (r.ok) {
        success(`Webhook set to ${url}`);
        if (opts.secret) log('  Secret token configured — pass the same value as WEBHOOK_SECRET to your deployment.');
      } else {
        error(`Failed: ${r.description}`); process.exit(1);
      }
    } else if (action === 'delete') {
      const r = await callApi(token, 'deleteWebhook', { drop_pending_updates: opts.drop ?? false });
      if (r.ok) success('Webhook deleted — bot is back to polling mode.');
      else { error(`Failed: ${r.description}`); process.exit(1); }
    } else if (action === 'info') {
      const r = await callApi(token, 'getWebhookInfo');
      if (r.ok) {
        log(`URL: ${r.result?.url || '(none — polling)'}`);
        log(`Pending updates: ${r.result?.pending_update_count ?? 0}`);
        if (r.result?.last_error_message) log(`Last error: ${r.result.last_error_message}`);
      } else { error(`Failed: ${r.description}`); process.exit(1); }
    } else {
      error(`Unknown action "${action}". Use: set <url> | delete | info`);
      process.exit(1);
    }
  } catch (err) {
    error(`Request failed: ${err}`);
    process.exit(1);
  }
}
