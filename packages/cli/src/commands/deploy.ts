import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { heading, log, error, success, findProjectRoot } from '../utils';

interface DeployOptions {
  run?: boolean;
}

const WORKER_ENTRY = `// Cloudflare Worker entry — deploy your Teact bot to the edge.
// src/index.tsx exports the bot and only calls bot.start() when run directly
// (\`if (import.meta.main)\`), so importing it here does NOT start polling.
import { bot } from './index';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
}

export default {
  fetch: (request: Request, env: Env, ctx?: { waitUntil(promise: Promise<unknown>): void }) =>
    bot.fetch(request, {
      token: env.TELEGRAM_BOT_TOKEN,
      secretToken: env.WEBHOOK_SECRET,
      // Reply to Telegram at once, but keep the Worker alive until the bot has finished
      // reacting (data loading, follow-up edits) — otherwise screens stick on "Loading…".
      waitUntil: ctx ? (p) => ctx.waitUntil(p) : undefined,
    }),
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

const VERCEL_ENTRY = `// Vercel Function (Edge runtime) — your Teact bot as a serverless webhook.
// Edge functions are bundled by Vercel, so your app's imports resolve exactly like in dev.
// src/index.tsx exports the bot and only calls bot.start() when run directly
// (\`if (import.meta.main)\`), so importing it here does NOT start polling.
import { bot } from '../src/index';

export const config = { runtime: 'edge' };

export default function handler(
  request: Request,
  context?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  return bot.fetch(request, {
    token: process.env.TELEGRAM_BOT_TOKEN,
    secretToken: process.env.WEBHOOK_SECRET,
    // Reply to Telegram at once; keep the function alive until the bot has finished
    // reacting (data loading, follow-up edits).
    waitUntil: context ? (p) => context.waitUntil(p) : undefined,
  });
}
`;

// Without these, Vercel treats a bot project as a static site: it runs `npm run build`
// (teact build — not needed for a function) and, with no public/ folder, serves the
// project ROOT as static files — which can expose files like .env.
const VERCEL_CONFIG = JSON.stringify(
  {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    buildCommand: "echo 'Teact: no static build needed — the bot runs in api/telegram.ts'",
    outputDirectory: 'public',
  },
  null,
  2,
) + '\n';

const VERCEL_PUBLIC_INDEX = `<!doctype html>
<meta charset="utf-8" />
<title>Teact bot</title>
<p>This deployment hosts a Telegram bot. Its webhook endpoint is <code>/api/telegram</code>.</p>
`;

function warnIfBotNotExported(root: string): void {
  const entryFile = ['src/index.ts', 'src/index.tsx'].map((f) => resolve(root, f)).find(existsSync);
  if (!entryFile || !/export\s+(const|let|var)\s+bot\b/.test(readFileSync(entryFile, 'utf-8'))) {
    log('⚠ Your entry should `export const bot = createBot(...)` and guard start with');
    log('  `if (import.meta.main) bot.start();` so the function can import the bot without polling.');
  }
}

/** Scaffold a Vercel deployment (api/telegram.ts). With --run, also invokes `vercel deploy --prod`. */
async function deployVercel(root: string, opts: DeployOptions): Promise<void> {
  heading('Deploy to Vercel');
  warnIfBotNotExported(root);

  const fn = resolve(root, 'api/telegram.ts');
  if (existsSync(fn)) log('• api/telegram.ts already exists — leaving it as is');
  else {
    mkdirSync(resolve(root, 'api'), { recursive: true });
    writeFileSync(fn, VERCEL_ENTRY);
    success('created api/telegram.ts');
  }

  const config = resolve(root, 'vercel.json');
  if (existsSync(config)) log('• vercel.json already exists — leaving it as is (make sure outputDirectory is not the project root)');
  else { writeFileSync(config, VERCEL_CONFIG); success('created vercel.json'); }

  const index = resolve(root, 'public/index.html');
  if (!existsSync(index)) {
    mkdirSync(resolve(root, 'public'), { recursive: true });
    writeFileSync(index, VERCEL_PUBLIC_INDEX);
    success('created public/index.html');
  }

  log('');
  log('Next steps:');
  log('  1. bunx vercel link                                # once: connect this folder to a Vercel project');
  log('  2. bunx vercel env add TELEGRAM_BOT_TOKEN production');
  log('  3. bunx vercel env add WEBHOOK_SECRET production   # any random string');
  log('  4. bunx vercel deploy --prod                        # or: teact deploy vercel --run');
  log('  5. teact webhook set https://<your-app>.vercel.app/api/telegram --secret <same WEBHOOK_SECRET>');
  log('');
  log('ℹ Use a durable session store (kvSessionStore with Redis/Upstash/KV): serverless');
  log('  instances don\'t share memory, so the default in-memory sessions won\'t persist.');

  if (opts.run) {
    log('');
    log('▶ Running vercel deploy --prod…');
    const proc = Bun.spawn(['bunx', 'vercel', 'deploy', '--prod'], { cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
    const code = await proc.exited;
    if (code !== 0) { error('vercel deploy failed'); process.exit(code ?? 1); }
    success('Deployed! Now run step 5 to point Telegram at your function.');
  }
}

/**
 * Scaffold a serverless deployment and print the steps. Targets: `cloudflare` (default;
 * src/worker.ts + wrangler.jsonc) and `vercel` (api/telegram.ts). With --run, also invokes
 * the platform's deploy command.
 */
export async function deployCommand(target: string | undefined, opts: DeployOptions): Promise<void> {
  const platform = (target ?? 'cloudflare').toLowerCase();
  const root = findProjectRoot();
  if (!root) { error('No Teact project found. Run inside a project directory.'); process.exit(1); }

  if (platform === 'vercel') return deployVercel(root, opts);
  if (platform !== 'cloudflare') {
    error(`Unknown target "${platform}". Supported: cloudflare, vercel.`);
    log('For other platforms (Deno/Bun/Node), export a fetch handler that calls bot.fetch(request).');
    process.exit(1);
  }

  heading('Deploy to Cloudflare Workers');

  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
  // Workers names: lowercase a-z0-9 and dashes, no leading/trailing dash (e.g. "@me/My_Bot" → "me-my-bot").
  const name = String(pkg.name ?? 'teact-bot')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'teact-bot';

  // Warn if the bot isn't exported from the entry (worker.ts imports it from ./index)
  warnIfBotNotExported(root);

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
  log('');
  log('ℹ On the edge there is no filesystem, so teact.config.ts is NOT auto-loaded.');
  log('  Pass your plugins directly: createBot({ plugins: [...] }) so they run on Workers.');

  if (opts.run) {
    log('');
    log('▶ Running wrangler deploy…');
    const proc = Bun.spawn(['bunx', 'wrangler', 'deploy'], { cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
    const code = await proc.exited;
    if (code !== 0) { error('wrangler deploy failed'); process.exit(code ?? 1); }
    success('Deployed! Now run step 4 to point Telegram at your worker.');
  }
}
