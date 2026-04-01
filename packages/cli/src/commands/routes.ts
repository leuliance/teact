import * as p from '@clack/prompts';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { findProjectRoot } from '../utils';

export async function routesCommand(): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error('No Teact project found');
    process.exit(1);
  }

  const tsxEntry = resolve(root, 'src/index.tsx');
  const tsEntry = resolve(root, 'src/index.ts');
  const entry = existsSync(tsxEntry) ? tsxEntry : existsSync(tsEntry) ? tsEntry : null;

  if (!entry) {
    p.log.error('Could not find src/index.tsx or src/index.ts');
    process.exit(1);
  }

  const source = readFileSync(entry, 'utf-8');
  const routeRegex = /['"](\/.+?)['"]\s*[,:]/g;
  const routes: string[] = [];
  let match;
  while ((match = routeRegex.exec(source)) !== null) {
    if (match[1] && !routes.includes(match[1])) {
      routes.push(match[1]);
    }
  }

  p.intro('Route Table');
  if (routes.length === 0) {
    p.log.warn('No routes found. Make sure you use createRouter() in src/index.tsx');
  } else {
    for (const route of routes.sort()) {
      p.log.info(`  ${route}`);
    }
    p.log.info(`\n  ${routes.length} routes found`);
  }
  p.outro('');
}
