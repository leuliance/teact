import { resolve } from 'path';
import { existsSync } from 'fs';
import { heading, log, error, findProjectRoot } from '../utils';

/**
 * Run the production build (`dist/index.js`). Run `teact build` first.
 */
export async function startCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    error('No Teact project found. Run this command inside a Teact project directory.');
    process.exit(1);
  }

  const entry = resolve(projectRoot, 'dist/index.js');
  if (!existsSync(entry)) {
    error('No production build found at dist/index.js.\n  → Run `teact build` first.');
    process.exit(1);
  }

  heading('Starting Teact bot (production)');
  log(`Entry: dist/index.js`);

  const proc = Bun.spawn(['bun', 'run', entry], {
    cwd: projectRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  const code = await proc.exited;
  process.exit(code ?? 0);
}
