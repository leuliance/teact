import { resolve } from 'path';
import { createServer, version as viteVersion } from 'vite';
import { ViteNodeServer } from 'vite-node/server';
import { ViteNodeRunner } from 'vite-node/client';
import { installSourcemapsSupport } from 'vite-node/source-map';
import { createHotContext, handleMessage, viteNodeHmrPlugin } from 'vite-node/hmr';
import { createDevConfig } from '../vite-config';
import { log, success } from '../utils';

/**
 * Vite-node dev server (module-level HMR through Vite's plugin pipeline). Used with
 * `teact dev --vite`, automatically when the project has a vite.config.*, or when the
 * CLI is not running under Bun.
 */
export async function devWithVite(projectRoot: string, entry: string): Promise<void> {
  const entryPath = resolve(projectRoot, entry);
  const files = [entryPath];

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
