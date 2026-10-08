import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { c, heading, findProjectRoot, findEntry, readJson, readEnvVar, elapsed } from '../utils';

export type Status = 'ok' | 'warn' | 'error' | 'info';

export interface CheckResult {
  section: 'Environment' | 'Project' | 'Telegram' | 'Dependencies';
  status: Status;
  message: string;
  fix?: string[];
}

export interface DoctorOptions {
  offline?: boolean;
}

export const MIN_BUN_VERSION = '1.1.0';
const TELEGRAM_TIMEOUT_MS = 3000;

/** Database packages and the client libraries that can back them (at least one needed). */
export const DB_CLIENT_PEERS: Record<string, { clients: string[]; builtin?: string }> = {
  '@teactjs/redis': { clients: ['ioredis', 'redis', '@upstash/redis'], builtin: "Bun's RedisClient" },
  '@teactjs/postgres': { clients: ['pg', 'postgres', '@neondatabase/serverless', '@electric-sql/pglite'] },
  '@teactjs/sqlite': { clients: ['better-sqlite3'], builtin: 'bun:sqlite' },
  '@teactjs/mongodb': { clients: ['mongodb'] },
};

// ---- helpers (exported for tests) ----

/** node_modules directories visible from `root` (root and every ancestor — workspaces hoist). */
export function nodeModulesDirs(root: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(root);
  while (true) {
    const nm = resolve(dir, 'node_modules');
    if (existsSync(nm)) dirs.push(nm);
    const parent = dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

/** Installed version of `name` as Node resolution would find it from `root`, or null. */
export function installedVersion(root: string, name: string): string | null {
  for (const nm of nodeModulesDirs(root)) {
    const pkg = readJson(resolve(nm, name, 'package.json'));
    if (pkg?.version) return pkg.version;
  }
  return null;
}

/** Every distinct copy of `react` under the project's node_modules trees: version → paths. */
export function findPackageCopies(root: string, name = 'react'): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  const patterns = [
    `${name}/package.json`,
    `*/node_modules/${name}/package.json`,
    `@*/*/node_modules/${name}/package.json`,
  ];
  for (const nm of nodeModulesDirs(root)) {
    for (const pattern of patterns) {
      for (const rel of new Bun.Glob(pattern).scanSync({ cwd: nm, onlyFiles: true, followSymlinks: false })) {
        if (rel.startsWith('.')) continue; // .bun / .pnpm stores hold every version ever installed
        const pkg = readJson(resolve(nm, rel));
        if (pkg?.name !== name || !pkg.version) continue;
        const list = versions.get(pkg.version) ?? [];
        list.push(resolve(nm, rel, '..'));
        versions.set(pkg.version, list);
      }
    }
  }
  return versions;
}

/** Installed @teactjs/* packages and their versions. */
export function teactVersions(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const nm of nodeModulesDirs(root).reverse()) {
    const scope = resolve(nm, '@teactjs');
    if (!existsSync(scope)) continue;
    for (const name of readdirSync(scope)) {
      const pkg = readJson(resolve(scope, name, 'package.json'));
      if (pkg?.version) out[`@teactjs/${name}`] = pkg.version; // nearer node_modules wins
    }
  }
  return out;
}

export function compareVersions(a: string, b: string): number {
  if (typeof Bun !== 'undefined' && Bun.semver) return Bun.semver.order(a, b);
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
}

async function telegram(token: string, method: string): Promise<{ ok: boolean; result?: any; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} from api.telegram.org`);
  }
}

function configMode(root: string): 'polling' | 'webhook' {
  for (const f of ['teact.config.ts', 'teact.config.js']) {
    const p = resolve(root, f);
    if (existsSync(p) && /mode\s*:\s*['"]webhook['"]/.test(readFileSync(p, 'utf-8'))) return 'webhook';
  }
  return 'polling';
}

// ---- checks ----

async function checkEnvironment(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const bun = typeof Bun !== 'undefined' ? Bun.version : null;
  if (!bun) {
    out.push({ section: 'Environment', status: 'error', message: 'Not running under Bun', fix: ['Install Bun: curl -fsSL https://bun.sh/install | bash'] });
  } else if (compareVersions(bun, MIN_BUN_VERSION) < 0) {
    out.push({ section: 'Environment', status: 'error', message: `Bun ${bun} is older than the minimum ${MIN_BUN_VERSION}`, fix: ['Upgrade: bun upgrade'] });
  } else {
    out.push({ section: 'Environment', status: 'ok', message: `Bun ${bun}` });
  }
  return out;
}

async function checkProject(root: string): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const S = 'Project' as const;
  out.push({ section: S, status: 'ok', message: `Project: ${root}` });

  const required: Array<[string, string, string]> = [
    ['package.json', 'package.json', 'Run: bun init'],
    ['tsconfig.json', 'tsconfig.json', 'Add a tsconfig.json with "jsx": "react-jsx"'],
    ['node_modules', 'Dependencies installed', 'Run: bun install'],
  ];
  for (const [path, label, fix] of required) {
    const exists = path === 'node_modules' ? nodeModulesDirs(root).length > 0 : existsSync(resolve(root, path));
    out.push(exists ? { section: S, status: 'ok', message: label } : { section: S, status: 'error', message: `${label} missing`, fix: [fix] });
  }
  const entry = findEntry(root);
  out.push(entry
    ? { section: S, status: 'ok', message: `Entry file (${entry})` }
    : { section: S, status: 'error', message: 'No entry file (src/index.tsx)', fix: ['Create src/index.tsx as your bot entry point'] });
  if (!existsSync(resolve(root, 'teact.config.ts')) && !existsSync(resolve(root, 'teact.config.js'))) {
    out.push({ section: S, status: 'info', message: 'teact.config.ts not found (optional)' });
  }

  const ts = installedVersion(root, 'typescript');
  out.push(ts
    ? { section: S, status: 'ok', message: `TypeScript ${ts}` }
    : { section: S, status: 'warn', message: 'TypeScript not installed locally', fix: ['bun add -d typescript'] });

  // Environment variables
  if (!existsSync(resolve(root, '.env')) && !process.env.TELEGRAM_BOT_TOKEN) {
    out.push({ section: S, status: 'warn', message: '.env file not found', fix: ['echo "TELEGRAM_BOT_TOKEN=" > .env'] });
  }
  const mode = configMode(root);
  const usesWebhook = mode === 'webhook' || existsSync(resolve(root, 'wrangler.jsonc')) || existsSync(resolve(root, 'wrangler.toml'));
  if (usesWebhook && !readEnvVar(root, 'WEBHOOK_SECRET')) {
    out.push({
      section: S, status: 'warn', message: 'WEBHOOK_SECRET is not set (webhook/edge deploy detected)',
      fix: ['Add WEBHOOK_SECRET=<random string> to .env (and `wrangler secret put WEBHOOK_SECRET` on Workers)'],
    });
  }
  return out;
}

async function checkTelegram(root: string, offline: boolean): Promise<CheckResult[]> {
  const S = 'Telegram' as const;
  const token = readEnvVar(root, 'TELEGRAM_BOT_TOKEN');
  if (!token) {
    return [{ section: S, status: 'error', message: 'TELEGRAM_BOT_TOKEN is not set', fix: ['Get a token from @BotFather', 'Add it to .env: TELEGRAM_BOT_TOKEN=123456:ABC-DEF…'] }];
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return [{ section: S, status: 'error', message: 'TELEGRAM_BOT_TOKEN does not look like a Telegram token', fix: ['Expected format: 123456789:ABCdef… (from @BotFather)'] }];
  }
  if (offline) return [{ section: S, status: 'info', message: 'Token format OK (network checks skipped: --offline)' }];

  const out: CheckResult[] = [];
  const [me, hook] = await Promise.allSettled([telegram(token, 'getMe'), telegram(token, 'getWebhookInfo')]);
  if (me.status === 'rejected') {
    const timeout = String(me.reason).includes('Timeout') || (me.reason as Error)?.name === 'TimeoutError';
    out.push({ section: S, status: 'warn', message: `Could not reach Telegram (${timeout ? `timed out after ${TELEGRAM_TIMEOUT_MS / 1000}s` : (me.reason as Error)?.message ?? me.reason})`, fix: ['Check your network, or skip with --offline'] });
    return out;
  }
  if (!me.value.ok) {
    out.push({ section: S, status: 'error', message: `Token rejected by Telegram: ${me.value.description}`, fix: ['Regenerate it with @BotFather (/token)'] });
    return out;
  }
  out.push({ section: S, status: 'ok', message: `Token valid — @${me.value.result?.username} (id ${me.value.result?.id})` });

  if (hook.status === 'fulfilled' && hook.value.ok) {
    const url: string = hook.value.result?.url ?? '';
    const mode = configMode(root);
    if (url && mode === 'polling') {
      out.push({
        section: S, status: 'warn', message: `A webhook is set (${url}) — polling (teact dev) will not receive updates`,
        fix: ['Remove it for local dev: teact webhook delete'],
      });
    } else if (url) {
      out.push({ section: S, status: 'ok', message: `Webhook: ${url} (${hook.value.result?.pending_update_count ?? 0} pending)` });
      if (hook.value.result?.last_error_message) out.push({ section: S, status: 'warn', message: `Last webhook error: ${hook.value.result.last_error_message}` });
    } else {
      out.push({ section: S, status: mode === 'webhook' ? 'warn' : 'ok', message: mode === 'webhook' ? 'teact.config uses webhook mode but no webhook is set' : 'No webhook set (polling mode)', fix: mode === 'webhook' ? ['teact webhook set <https-url>'] : undefined });
    }
  }
  return out;
}

async function checkDependencies(root: string): Promise<CheckResult[]> {
  const S = 'Dependencies' as const;
  const out: CheckResult[] = [];

  const pkg = readJson(resolve(root, 'package.json')) ?? {};
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@teactjs/'));
  if (declared.length === 0) {
    out.push({ section: S, status: 'error', message: 'No @teactjs/* packages in package.json', fix: ['bun add @teactjs/core @teactjs/ui @teactjs/telegram'] });
  }

  const installed = teactVersions(root);
  const names = Object.keys(installed);
  const distinct = [...new Set(Object.values(installed))];
  if (names.length && distinct.length === 1) {
    out.push({ section: S, status: 'ok', message: `@teactjs/* ${distinct[0]} (${names.length} packages)` });
  } else if (distinct.length > 1) {
    out.push({
      section: S, status: 'warn', message: `@teactjs/* versions differ: ${names.map((n) => `${n.slice(9)}@${installed[n]}`).join(', ')}`,
      fix: ['Align them, e.g.: bun add ' + names.map((n) => `${n}@${distinct.sort(compareVersions).at(-1)}`).join(' ')],
    });
  }
  for (const d of declared) {
    if (!installed[d] && nodeModulesDirs(root).length) out.push({ section: S, status: 'error', message: `${d} is declared but not installed`, fix: ['Run: bun install'] });
  }

  const reacts = findPackageCopies(root, 'react');
  if (reacts.size > 1) {
    out.push({
      section: S, status: 'error', message: `Multiple React versions installed: ${[...reacts.keys()].join(', ')} — causes "Invalid hook call" errors`,
      fix: [...[...reacts.entries()].map(([v, paths]) => `${v}: ${paths.join(', ')}`), 'Dedupe: pin one react version (overrides/resolutions) and reinstall'],
    });
  } else if (reacts.size === 1) {
    out.push({ section: S, status: 'ok', message: `React ${[...reacts.keys()][0]} (single copy)` });
  }

  for (const [name, { clients, builtin }] of Object.entries(DB_CLIENT_PEERS)) {
    if (!installed[name]) continue;
    const present = clients.filter((cl) => installedVersion(root, cl));
    if (present.length) {
      out.push({ section: S, status: 'ok', message: `${name} client: ${present.join(', ')}` });
    } else {
      out.push({
        section: S, status: builtin ? 'info' : 'error',
        message: builtin ? `${name}: no client library installed — fine if you use ${builtin}` : `${name} needs a client library (none installed)`,
        fix: builtin ? undefined : [`Install one of: ${clients.join(', ')}  (e.g. teact add ${name.slice(9)} --client …)`],
      });
    }
    const peers = readJson(resolve(nodeModulesDirs(root).find((nm) => existsSync(resolve(nm, name)))!, name, 'package.json'))?.peerDependencies ?? {};
    for (const peer of Object.keys(peers)) {
      if (peer.startsWith('@teactjs/') && !installed[peer]) {
        out.push({ section: S, status: 'error', message: `${name} requires ${peer}`, fix: [`bun add ${peer}`] });
      }
    }
  }
  return out;
}

const ICON: Record<Status, (s: string) => string> = {
  ok: (s) => `${c.green('✓')} ${s}`,
  warn: (s) => `${c.yellow('⚠')} ${s}`,
  error: (s) => `${c.red('✗')} ${s}`,
  info: (s) => `${c.blue('ℹ')} ${c.dim(s)}`,
};

export async function runDoctorChecks(root: string | null, opts: DoctorOptions = {}): Promise<CheckResult[]> {
  const jobs: Array<Promise<CheckResult[]>> = [checkEnvironment()];
  if (root) jobs.push(checkProject(root), checkTelegram(root, !!opts.offline), checkDependencies(root));
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [{ section: 'Environment' as const, status: 'warn' as const, message: `Check crashed: ${s.reason}` }]));
}

export async function doctorCommand(opts: DoctorOptions = {}): Promise<void> {
  const start = performance.now();
  heading('Teact Doctor');
  const root = findProjectRoot();
  const results = await runDoctorChecks(root, opts);

  for (const section of ['Environment', 'Project', 'Telegram', 'Dependencies'] as const) {
    const items = results.filter((r) => r.section === section);
    if (!items.length) continue;
    console.log(c.bold(section));
    for (const r of items) {
      console.log(`  ${ICON[r.status](r.message)}`);
      for (const f of r.fix ?? []) console.log(`      ${c.dim('→')} ${f}`);
    }
    console.log('');
  }
  if (!root) console.log(`${c.blue('ℹ')} No Teact project found here — create one with: teact create my-bot\n`);

  const errors = results.filter((r) => r.status === 'error').length;
  const warnings = results.filter((r) => r.status === 'warn').length;
  const summary = errors || warnings
    ? `${errors ? c.red(`${errors} error(s)`) : ''}${errors && warnings ? ', ' : ''}${warnings ? c.yellow(`${warnings} warning(s)`) : ''}`
    : c.green('All checks passed!');
  console.log(`${summary} ${c.dim(`(${elapsed(start)})`)}`);
  if (errors) process.exitCode = 1;
}
