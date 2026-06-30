import { resolve } from 'path';
import { existsSync } from 'fs';
import { heading, log, error, success, findProjectRoot } from '../utils';

/**
 * Type-check the project with `tsc --noEmit` (no separate tsc install needed — uses bunx).
 */
export async function typecheckCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    error('No Teact project found. Run this command inside a Teact project directory.');
    process.exit(1);
  }

  if (!existsSync(resolve(projectRoot, 'tsconfig.json'))) {
    error('No tsconfig.json found in the project.');
    process.exit(1);
  }

  heading('Type-checking project');
  log('Running tsc --noEmit…');

  const proc = Bun.spawn(['bunx', 'tsc', '--noEmit'], {
    cwd: projectRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code === 0) {
    success('No type errors.');
  } else {
    error('Type errors found.');
    process.exit(code ?? 1);
  }
}
