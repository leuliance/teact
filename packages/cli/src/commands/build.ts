import { resolve } from 'path';
import { existsSync } from 'fs';
import { build } from 'vite';
import { createBuildConfig } from '../vite-config';
import { heading, log, error, success, findProjectRoot } from '../utils';

interface BuildOptions {
  entry?: string;
  minify?: boolean;
  sourcemap?: boolean;
}

export async function buildCommand(opts: BuildOptions): Promise<void> {
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    error('No Teact project found. Run this command inside a Teact project directory.');
    process.exit(1);
  }

  heading('Building Teact project');

  const entry = opts.entry || findEntry(projectRoot);
  if (!entry) {
    error('No entry file found. Create src/index.tsx or specify with --entry');
    process.exit(1);
  }

  log(`Entry: ${entry}`);
  log(`Output: dist/`);

  try {
    const config = createBuildConfig({
      root: projectRoot,
      entry,
      minify: opts.minify,
      sourcemap: opts.sourcemap,
    });

    await build(config);

    success('Build completed!');
    log(`Output written to ${resolve(projectRoot, 'dist')}`);
  } catch (err) {
    error(`Build failed: ${err}`);
    process.exit(1);
  }
}

function findEntry(projectRoot: string): string | null {
  const candidates = ['src/index.tsx', 'src/index.ts', 'src/bot.tsx', 'src/bot.ts'];
  for (const candidate of candidates) {
    if (existsSync(resolve(projectRoot, candidate))) return candidate;
  }
  return null;
}
