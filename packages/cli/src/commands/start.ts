import { resolve } from 'path';
import { existsSync } from 'fs';
import { heading, log, error, requireProjectRoot } from '../utils';

/**
 * Run the production build (`dist/index.js`). Run `teact build` first.
 */
export async function startCommand(): Promise<void> {
  const projectRoot = requireProjectRoot();

  const entry = resolve(projectRoot, 'dist/index.js');
  if (!existsSync(entry)) {
    error('No production build found at dist/index.js.\n  → Run `teact build` first.');
    process.exit(1);
  }

  heading('Starting Teact bot (production)');
  log(`Entry: dist/index.js`);

  const proc = Bun.spawn([process.execPath, 'run', entry], {
    cwd: projectRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
  });
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => proc.kill('SIGTERM'));
  const code = await proc.exited;
  process.exit(code ?? 0);
}
