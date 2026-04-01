import { resolve, join } from 'path';
import { existsSync } from 'fs';
import type { InlineConfig } from 'vite';

const TEACT_PACKAGES = [
  '@teact/core',
  '@teact/ui',
  '@teact/runtime',
  '@teact/renderer',
  '@teact/react',
  '@teact/telegram',
  '@teact/storage',
  '@teact/testing',
];

const EXTERNAL_DEPS = [
  'grammy',
  '@grammyjs/conversations',
  '@grammyjs/stream',
  '@grammyjs/auto-retry',
  '@tanstack/react-query',
];

interface TeactViteOptions {
  root: string;
  entry: string;
  mode?: 'development' | 'production';
}

export function createBaseConfig(opts: TeactViteOptions): InlineConfig {
  const { root, entry, mode = 'development' } = opts;

  return {
    root,
    mode,
    configFile: resolveUserConfig(root),
    oxc: {
      jsx: {
        runtime: 'automatic',
        importSource: 'react',
      },
    },
    resolve: {
      conditions: ['bun', 'node', 'import'],
      alias: {
        '@/': join(root, 'src') + '/',
      },
    },
    ssr: {
      target: 'node',
      noExternal: TEACT_PACKAGES,
      external: EXTERNAL_DEPS,
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
    logLevel: mode === 'production' ? 'warn' : 'info',
  };
}

export function createDevConfig(opts: TeactViteOptions): InlineConfig {
  return {
    ...createBaseConfig(opts),
    server: {
      watch: {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.teact/**'],
      },
      hmr: false,
    },
  };
}

export function createBuildConfig(
  opts: TeactViteOptions & { minify?: boolean; sourcemap?: boolean },
): InlineConfig {
  const base = createBaseConfig({ ...opts, mode: 'production' });
  const outDir = resolve(opts.root, 'dist');

  return {
    ...base,
    build: {
      ssr: resolve(opts.root, opts.entry),
      outDir,
      minify: opts.minify !== false,
      sourcemap: opts.sourcemap !== false,
      rollupOptions: {
        external: [
          ...EXTERNAL_DEPS,
          /^node:/,
        ],
      },
    },
  };
}

function resolveUserConfig(root: string): string | false {
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    const p = resolve(root, name);
    if (existsSync(p)) return p;
  }
  return false;
}
