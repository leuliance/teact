import { resolve, relative } from 'path';
import { existsSync, rmSync, statSync } from 'fs';
import { isBuiltin } from 'module';
import { EXTERNAL_DEPS } from '../vite-config';
import { heading, log, fail, success, findEntry, findViteConfig, requireProjectRoot, elapsed, c } from '../utils';

export interface BuildOptions {
  entry?: string;
  minify?: boolean;
  sourcemap?: boolean;
  /** Force the Vite pipeline. */
  vite?: boolean;
  /** Runtime the bundle targets. @default 'bun' */
  target?: string;
  /** Bundle every dependency except grammY & co (self-contained dist, no node_modules needed for most deps). */
  standalone?: boolean;
}

export interface BunBuildOptions {
  root: string;
  entry: string;
  outDir?: string;
  minify?: boolean;
  sourcemap?: boolean;
  target?: 'bun' | 'node';
  standalone?: boolean;
}

/**
 * Packages that must never be bundled even in `--standalone` mode: grammY (and its plugins,
 * same list as the Vite build) plus database clients, which ship native addons or optional
 * dynamic requires that don't survive bundling.
 */
export const ALWAYS_EXTERNAL = [
  ...EXTERNAL_DEPS,
  'pg', 'pg-native', 'postgres', '@neondatabase/serverless',
  'ioredis', 'redis', '@upstash/redis',
  'mongodb', 'better-sqlite3',
];

function packageName(id: string): string {
  const parts = id.split('/');
  return id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const RESOLVE_EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.js'];

/**
 * Decide how a bare import is treated:
 * - `@teactjs/*` → bundled (like the Vite build's `ssr.noExternal`)
 * - builtins (`node:*`, `bun:*`, `fs`, …) → external
 * - other packages → external (resolved from node_modules at runtime, so React stays a
 *   single instance shared with your deps), unless `standalone` and not in ALWAYS_EXTERNAL.
 */
export function isExternalImport(id: string, standalone = false): boolean {
  if (id.startsWith('node:') || id.startsWith('bun:') || isBuiltin(id) || id === 'bun') return true;
  const name = packageName(id);
  if (name.startsWith('@teactjs/')) return false;
  if (ALWAYS_EXTERNAL.includes(name)) return true;
  return !standalone;
}

export async function bunBuild(opts: BunBuildOptions): Promise<{ success: boolean; outputs: string[]; logs: string[] }> {
  const root = resolve(opts.root);
  const outDir = resolve(root, opts.outDir ?? 'dist');
  const target = opts.target ?? 'bun';

  const result = await Bun.build({
    entrypoints: [resolve(root, opts.entry)],
    outdir: outDir,
    naming: { entry: 'index.[ext]', chunk: 'chunks/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
    target,
    format: 'esm',
    minify: opts.minify !== false,
    sourcemap: opts.sourcemap === false ? 'none' : 'linked',
    jsx: { runtime: 'automatic', importSource: 'react' },
    define: { 'process.env.NODE_ENV': '"production"' },
    root,
    throw: false,
    plugins: [
      {
        name: 'teact-externals',
        setup(build) {
          // `@/foo` → <root>/src/foo (same alias as the Vite config), when tsconfig has no path for it.
          build.onResolve({ filter: /^@\// }, (args) => {
            const base = resolve(root, 'src', args.path.slice(2));
            for (const ext of RESOLVE_EXTS) {
              const p = base + ext;
              if (existsSync(p) && statSync(p).isFile()) return { path: p };
            }
            return undefined;
          });
          build.onResolve({ filter: /^[^./@]|^@[^/]+\// }, (args) => {
            if (args.path.startsWith('@/')) return undefined;
            if (isExternalImport(args.path, opts.standalone)) return { path: args.path, external: true };
            return undefined; // default resolution → bundled
          });
        },
      },
    ],
  });

  return {
    success: result.success,
    outputs: result.outputs.map((o) => o.path),
    logs: result.logs.map((l) => String(l.message ?? l)),
  };
}

export async function buildCommand(opts: BuildOptions): Promise<void> {
  const projectRoot = requireProjectRoot();
  const start = performance.now();

  const entry = opts.entry || findEntry(projectRoot);
  if (!entry || !existsSync(resolve(projectRoot, entry))) {
    fail(entry ? `Entry file not found: ${entry}` : 'No entry file found.', 'Create src/index.tsx or pass one with --entry <file>');
  }

  const target = (opts.target ?? 'bun') as 'bun' | 'node';
  if (target !== 'bun' && target !== 'node') fail(`Unknown --target "${opts.target}".`, 'Use --target bun or --target node');

  const viteConfig = findViteConfig(projectRoot);
  const useVite = !!opts.vite || !!viteConfig || typeof Bun === 'undefined';

  heading('Building Teact project');
  log(`Entry:   ${entry}`);
  log(`Bundler: ${useVite ? `vite ${c.dim(opts.vite ? '(--vite)' : viteConfig ? `(${relative(projectRoot, viteConfig)})` : '')}` : `Bun.build ${c.dim(`(target ${target}${opts.standalone ? ', standalone' : ''})`)}`}`);

  const outDir = resolve(projectRoot, 'dist');
  try {
    if (useVite) {
      if (opts.target === 'node' || opts.standalone) log(c.dim('--target/--standalone are ignored by the Vite pipeline'));
      const { buildWithVite } = await import('./build-vite');
      await buildWithVite({ root: projectRoot, entry, minify: opts.minify, sourcemap: opts.sourcemap });
    } else {
      rmSync(outDir, { recursive: true, force: true });
      const result = await bunBuild({
        root: projectRoot,
        entry,
        minify: opts.minify,
        sourcemap: opts.sourcemap,
        target,
        standalone: opts.standalone,
      });
      if (!result.success) {
        for (const l of result.logs) console.error(l);
        fail('Build failed.');
      }
      for (const out of result.outputs) {
        const size = statSync(out).size;
        log(`  ${relative(projectRoot, out).padEnd(28)} ${c.dim(`${(size / 1024).toFixed(1)} kB`)}`);
      }
    }
  } catch (err) {
    fail(`Build failed: ${err instanceof Error ? err.message : err}`);
  }

  success(`Built in ${elapsed(start)} → ${relative(process.cwd(), outDir) || '.'}/`);
  log(`Run it with: ${c.bold('teact start')}`);
}
