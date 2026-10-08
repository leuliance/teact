import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

export function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      flags[key] = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

/** Read and parse a JSON file, returning `null` when it is missing or invalid. */
export function readJson<T = any>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function findProjectRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  while (true) {
    if (existsSync(resolve(dir, 'teact.config.ts')) || existsSync(resolve(dir, 'teact.config.js'))) {
      return dir;
    }
    const pkg = readJson(resolve(dir, 'package.json'));
    if (pkg) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['@teactjs/core'] || deps['@teactjs/ui']) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Default entry-file candidates, in priority order. */
export const ENTRY_CANDIDATES = [
  'src/index.tsx',
  'src/index.ts',
  'src/bot.tsx',
  'src/bot.ts',
  'index.tsx',
  'index.ts',
];

export function findEntry(projectRoot: string): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    if (existsSync(resolve(projectRoot, candidate))) return candidate;
  }
  return null;
}

/** Path of a user `vite.config.*` in the project, if any (opts the project into the Vite pipeline). */
export function findViteConfig(projectRoot: string): string | null {
  for (const name of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    const p = resolve(projectRoot, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Parse a dotenv file body (KEY=value, optional quotes, `export ` prefix, # comments). */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Look up an env var in process.env, then in the project's `.env.local` / `.env`. */
export function readEnvVar(projectRoot: string, name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env']) {
    const p = resolve(projectRoot, file);
    if (!existsSync(p)) continue;
    const v = parseDotEnv(readFileSync(p, 'utf-8'))[name];
    if (v) return v;
  }
  return undefined;
}

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm';

/**
 * Detect the project's package manager from its lockfile (walking up for workspaces),
 * then from `packageManager` in package.json. Falls back to bun.
 */
export function detectPackageManager(from: string): PackageManager {
  let dir = resolve(from);
  while (true) {
    if (existsSync(resolve(dir, 'bun.lock')) || existsSync(resolve(dir, 'bun.lockb'))) return 'bun';
    if (existsSync(resolve(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(resolve(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(resolve(dir, 'package-lock.json'))) return 'npm';
    const pm = readJson(resolve(dir, 'package.json'))?.packageManager;
    if (typeof pm === 'string') {
      const name = pm.split('@')[0];
      if (name === 'bun' || name === 'pnpm' || name === 'yarn' || name === 'npm') return name;
    }
    const parent = dirname(dir);
    if (parent === dir) return 'bun';
    dir = parent;
  }
}

/** The command that adds packages with the given package manager. */
export function installCommand(pm: PackageManager, packages: string[], dev = false): string[] {
  if (pm === 'npm') return ['npm', 'install', ...(dev ? ['--save-dev'] : []), ...packages];
  return [pm, 'add', ...(dev ? ['-D'] : []), ...packages];
}

// ---- Output ----

/** Colors are disabled by NO_COLOR (any value), TERM=dumb, or a non-TTY stdout (unless FORCE_COLOR). */
export function colorEnabled(env: Record<string, string | undefined> = process.env, isTTY = !!process.stdout.isTTY): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return isTTY;
}

const USE_COLOR = colorEnabled();

function wrap(open: string): (s: string) => string {
  return (s: string) => (USE_COLOR ? `\x1b[${open}m${s}\x1b[0m` : s);
}

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
};

export function log(message: string): void {
  console.log(`${c.cyan('[teact]')} ${message}`);
}

export function info(message: string): void {
  console.log(`${c.blue('ℹ')} ${message}`);
}

export function success(message: string): void {
  console.log(`${c.green('✓')} ${message}`);
}

export function warn(message: string): void {
  console.log(`${c.yellow('⚠')} ${message}`);
}

export function error(message: string): void {
  console.error(`${c.red('✗')} ${message}`);
}

export function hint(message: string): void {
  console.log(`  ${c.dim('→')} ${message}`);
}

export function heading(message: string): void {
  console.log(`\n${c.bold(c.magenta(message))}\n`);
}

/** Fail with an error message (and optional hint) and exit 1. */
export function fail(message: string, fix?: string): never {
  error(message);
  if (fix) hint(fix);
  process.exit(1);
}

export function requireProjectRoot(): string {
  return findProjectRoot() ?? fail('No Teact project found.', 'Run this command inside a Teact project directory, or create one: teact create my-bot');
}

/** Milliseconds since `start`, formatted. */
export function elapsed(start: number): string {
  const ms = performance.now() - start;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
