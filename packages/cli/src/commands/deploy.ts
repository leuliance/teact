import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { heading, log, error, success, findProjectRoot } from '../utils';

interface DeployOptions {
  run?: boolean;
}

const WORKER_ENTRY = `// Cloudflare Worker entry — deploy your Teact bot to the edge.
// src/index.ts exports the bot and only calls bot.start() when run directly
// (\`if (import.meta.main)\`), so importing it here does NOT start polling.
import { bot } from './index';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
}

export default {
  fetch: (request: Request, env: Env) =>
    bot.fetch(request, { token: env.TELEGRAM_BOT_TOKEN, secretToken: env.WEBHOOK_SECRET }),
};
`;

function wranglerConfig(name: string): string {
  return JSON.stringify(
    {
      $schema: 'node_modules/wrangler/config-schema.json',
      name,
      main: 'src/worker.ts',
      compatibility_date: '2024-09-23',
      compatibility_flags: ['nodejs_compat'],
    },
    null,
    2,
  ) + '\n';
}

/**
 * Scaffold a Cloudflare Workers deployment (src/worker.ts + wrangler.jsonc) and print
 * the steps. With --run, also invokes `wrangler deploy`.
 */
export async function deployCommand(target: string | undefined, opts: DeployOptions): Promise<void> {
  const platform = (target ?? 'cloudflare').toLowerCase();
  const root = findProjectRoot();
  if (!root) { error('No Teact project found. Run inside a project directory.'); process.exit(1); }

  if (platform !== 'cloudflare') {
    error(`Unknown target "${platform}". Supported: cloudflare.`);
    log('For other platforms (Vercel/Deno/Bun/Node), export a fetch handler that calls bot.fetch(request).');
    process.exit(1);
  }

  heading('Deploy to Cloudflare Workers');

  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
  const name = (pkg.name ?? 'teact-bot').replace(/[^a-z0-9-]/g, '-');

  // Warn if the bot isn't exported from the entry (worker.ts imports it from ./index)
  const entryFile = ['src/index.ts', 'src/index.tsx'].map((f) => resolve(root, f)).find(existsSync);
  if (!entryFile || !/export\s+(const|let|var)\s+bot\b/.test(readFileSync(entryFile, 'utf-8'))) {
    log('⚠ Your entry should `export const bot = createBot(...)` and guard start with');
    log('  `if (import.meta.main) bot.start();` so the worker can import the bot without polling.');
  }

  const worker = resolve(root, 'src/worker.ts');
  if (existsSync(worker)) log('• src/worker.ts already exists — leaving it as is');
  else { writeFileSync(worker, WORKER_ENTRY); success('created src/worker.ts'); }

  const wrangler = resolve(root, 'wrangler.jsonc');
  if (existsSync(wrangler)) log('• wrangler.jsonc already exists — leaving it as is');
  else { writeFileSync(wrangler, wranglerConfig(name)); success('created wrangler.jsonc'); }

  log('');
  log('Next steps:');
  log('  1. bunx wrangler secret put TELEGRAM_BOT_TOKEN');
  log('  2. bunx wrangler secret put WEBHOOK_SECRET        # any random string');
  log('  3. bunx wrangler deploy                            # or: teact deploy --run');
  log('  4. teact webhook set https://<your-worker>.workers.dev --secret <same WEBHOOK_SECRET>');

  if (opts.run) {
    log('');
    log('▶ Running wrangler deploy…');
    const proc = Bun.spawn(['bunx', 'wrangler', 'deploy'], { cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
    const code = await proc.exited;
    if (code !== 0) { error('wrangler deploy failed'); process.exit(code ?? 1); }
    success('Deployed! Now run step 4 to point Telegram at your worker.');
  }
}
