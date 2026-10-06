import { readFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { extractRoutes, type RouteInfo } from '../routes-extract';
import { c, heading, warn, hint, requireProjectRoot } from '../utils';

/** Scan `src/**\/*.{ts,tsx}` (or the project root if there is no src/) for createRouter() routes. */
export function scanProjectRoutes(root: string): RouteInfo[] {
  const base = existsSync(resolve(root, 'src')) ? resolve(root, 'src') : root;
  const glob = new Bun.Glob('**/*.{ts,tsx,js,jsx}');
  const routes: RouteInfo[] = [];
  for (const file of glob.scanSync({ cwd: base, onlyFiles: true })) {
    if (file.includes('node_modules') || file.startsWith('dist/') || /\.(test|spec)\.[jt]sx?$/.test(file)) continue;
    const abs = resolve(base, file);
    const src = readFileSync(abs, 'utf-8');
    if (!src.includes('createRouter')) continue;
    routes.push(...extractRoutes(src, relative(root, abs)));
  }
  return routes;
}

export async function routesCommand(opts: { json?: boolean } = {}): Promise<void> {
  const root = requireProjectRoot();
  const routes = scanProjectRoutes(root);

  if (opts.json) {
    console.log(JSON.stringify(routes, null, 2));
    return;
  }

  heading('Route table');
  if (routes.length === 0) {
    warn('No routes found.');
    hint("Declare routes with createRouter({ '/': Home, ... }) somewhere under src/.");
    return;
  }

  const pathW = Math.max(5, ...routes.map((r) => r.path.length)) + 2;
  const compW = Math.max(9, ...routes.map((r) => (r.component ?? '').length)) + 2;
  console.log(`  ${c.dim('ROUTE'.padEnd(pathW))}${c.dim('COMPONENT'.padEnd(compW))}${c.dim('COMMAND')}`);
  for (const r of routes) {
    const flags = [r.guard ? c.yellow('guarded') : '', r.deepLink ? c.magenta('deep-link') : ''].filter(Boolean).join(' ');
    const cmd = r.command ? `${c.green('/' + r.command)}${r.description ? c.dim(` — ${r.description}`) : ''}` : '';
    console.log(`  ${c.cyan(r.path.padEnd(pathW))}${(r.component ?? '').padEnd(compW)}${cmd}${flags ? `  ${flags}` : ''}`);
  }
  const files = [...new Set(routes.map((r) => r.file))];
  const commands = routes.filter((r) => r.command).length;
  const guards = routes.filter((r) => r.guard).length;
  console.log(`\n  ${routes.length} routes · ${commands} commands · ${guards} guarded ${c.dim(`(${files.join(', ')})`)}`);
}
