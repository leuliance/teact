import { resolve } from 'path';
import { existsSync } from 'fs';
import { createServer, version as viteVersion } from 'vite';
import { ViteNodeServer } from 'vite-node/server';
import { ViteNodeRunner } from 'vite-node/client';
import { installSourcemapsSupport } from 'vite-node/source-map';
import { createHotContext, handleMessage, viteNodeHmrPlugin } from 'vite-node/hmr';
import { createDevConfig } from '../vite-config';
import { heading, log, error, success, findProjectRoot } from '../utils';

interface DevOptions {
  entry?: string;
}

export async function devCommand(opts: DevOptions): Promise<void> {
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    error('No Teact project found. Run this command inside a Teact project directory.');
    process.exit(1);
  }

  heading('Starting Teact dev server');

  const entry = opts.entry || findEntry(projectRoot);
  if (!entry) {
    error('No entry file found. Create src/index.tsx or specify with --entry');
    process.exit(1);
  }

  const entryPath = resolve(projectRoot, entry);
  const files = [entryPath];

  log(`Entry: ${entry}`);
  log(`Mode: vite-node (HMR enabled)`);
  console.log('');

  const baseConfig = createDevConfig({ root: projectRoot, entry });

  const server = await createServer({
    ...baseConfig,
    logLevel: 'error',
    server: {
      ...baseConfig.server,
      hmr: true,
      watch: undefined,
    },
    plugins: [
      ...(Array.isArray(baseConfig.plugins) ? baseConfig.plugins : []),
      viteNodeHmrPlugin(),
    ],
  });

  const majorVersion = Number(viteVersion.split('.')[0]);
  if (majorVersion < 6) {
    await server.pluginContainer.buildStart({});
  } else {
    await (server as any).environments.client.pluginContainer.buildStart({});
  }

  const node = new ViteNodeServer(server);

  installSourcemapsSupport({
    getSourceMap: (source: string) => node.getSourceMap(source),
  });

  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule(id: string) {
      return node.fetchModule(id);
    },
    resolveId(id: string, importer?: string) {
      return node.resolveId(id, importer);
    },
    createHotContext(runner: any, url: string) {
      return createHotContext(runner, server.emitter, files, url);
    },
  });

  await runner.executeId('/@vite/env');

  for (const file of files) {
    await runner.executeFile(file);
  }

  success('Dev server started (watching for changes)');

  server.emitter?.on('message', (payload: any) => {
    handleMessage(runner, server.emitter, files, payload);
  });

  process.on('uncaughtException', (err) => {
    console.error('\x1b[31m[vite-node] Failed to execute file: \n\x1b[0m', err);
  });

  const shutdown = async () => {
    log('Shutting down dev server…');
    await server.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function findEntry(projectRoot: string): string | null {
  const candidates = [
    'src/index.tsx',
    'src/index.ts',
    'src/bot.tsx',
    'src/bot.ts',
    'index.tsx',
    'index.ts',
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(projectRoot, candidate))) {
      return candidate;
    }
  }

  return null;
}
