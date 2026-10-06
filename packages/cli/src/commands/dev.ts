import { resolve, relative } from 'path';
import { existsSync } from 'fs';
import { heading, log, fail, findEntry, findViteConfig, requireProjectRoot, c } from '../utils';

export interface DevOptions {
  entry?: string;
  /** Force the vite-node pipeline. */
  vite?: boolean;
  /** Use `bun --hot` (in-process soft reload) instead of `bun --watch` (process restart). */
  hot?: boolean;
  /** Clear the terminal on every reload. */
  clear?: boolean;
}

export type DevRunner = 'bun-watch' | 'bun-hot' | 'vite';

/**
 * Pick the dev pipeline:
 * - `--vite`, a project vite.config.*, or a non-Bun runtime → vite-node (Vite plugins, HMR).
 * - otherwise Bun-native: `bun --watch` by default, `bun --hot` with `--hot`.
 *
 * Why `--watch` is the default: it restarts the process, so every reload starts from a clean
 * slate — timers, sockets, DB pools, `process.on` listeners and the previous grammY poller are
 * torn down by the OS (and Bun runs the bot's SIGTERM handler first, so polling stops
 * gracefully). `bun --hot` re-evaluates the whole module graph (node_modules included, so
 * React is never duplicated) while keeping `globalThis`; core's HMR hook then stops the
 * previous bot on `bot.start()`, but anything else a module started (intervals, connections,
 * signal listeners) leaks across reloads. The reload-time difference is small because both
 * re-evaluate everything, so robustness wins.
 */
export function resolveDevRunner(opts: DevOptions, hasViteConfig: boolean, isBun = typeof Bun !== 'undefined'): DevRunner {
  if (opts.vite || hasViteConfig || !isBun) return 'vite';
  return opts.hot ? 'bun-hot' : 'bun-watch';
}

/** Arguments passed to the bun binary for the Bun-native dev runner. */
export function bunDevArgs(entryPath: string, runner: Exclude<DevRunner, 'vite'>, clear = false): string[] {
  return [runner === 'bun-hot' ? '--hot' : '--watch', ...(clear ? [] : ['--no-clear-screen']), entryPath];
}

export async function devCommand(opts: DevOptions): Promise<void> {
  const projectRoot = requireProjectRoot();

  const entry = opts.entry || findEntry(projectRoot);
  if (!entry || !existsSync(resolve(projectRoot, entry))) {
    fail(
      entry ? `Entry file not found: ${entry}` : 'No entry file found.',
      'Create src/index.tsx or pass one with --entry <file>',
    );
  }

  const viteConfig = findViteConfig(projectRoot);
  const runner = resolveDevRunner(opts, !!viteConfig);

  heading('Starting Teact dev server');
  log(`Entry: ${entry}`);

  if (runner === 'vite') {
    const why = opts.vite ? '--vite' : viteConfig ? relative(projectRoot, viteConfig) : 'not running under Bun';
    log(`Mode:  vite-node HMR ${c.dim(`(${why})`)}`);
    console.log('');
    const { devWithVite } = await import('./dev-vite');
    await devWithVite(projectRoot, entry);
    return;
  }

  log(`Mode:  ${runner === 'bun-hot' ? 'bun --hot (in-process reload)' : 'bun --watch (restart on change)'}`);
  console.log('');

  const proc = Bun.spawn([process.execPath, ...bunDevArgs(resolve(projectRoot, entry), runner, opts.clear)], {
    cwd: projectRoot, // Bun auto-loads .env / .env.development / .env.local from here
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  // Ctrl+C reaches the child through the process group; just wait for it to exit.
  // A SIGTERM aimed only at the CLI (e.g. from a process manager) is forwarded.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => proc.kill('SIGTERM'));

  const code = await proc.exited;
  process.exit(code ?? 0);
}
