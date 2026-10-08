import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { REGISTRY, findPlugin, mergeWirings, renderSnippet, renderImport, UnknownClientError } from '../packages/cli/src/add/registry';
import { wireSource, maskSource } from '../packages/cli/src/add/wire';
import { resolveWiring, missingPackages } from '../packages/cli/src/commands/add';
import { detectPackageManager, installCommand, parseDotEnv, colorEnabled } from '../packages/cli/src/utils';

describe('teact add · registry', () => {
  test('every entry builds with its default client and lists an @teactjs package', () => {
    for (const entry of REGISTRY) {
      const w = entry.build();
      expect(w.packages.some((p) => p.startsWith('@teactjs/'))).toBe(true);
    }
  });

  test('aliases and scoped names resolve', () => {
    expect(findPlugin('pg')?.id).toBe('postgres');
    expect(findPlugin('@teactjs/redis')?.id).toBe('redis');
    expect(findPlugin('Rate-Limit')?.id).toBe('rate-limit');
    expect(findPlugin('mongo')?.id).toBe('mongodb');
    expect(findPlugin('nope')).toBeUndefined();
  });

  test('sub-plugins map to @teactjs/plugins', () => {
    for (const id of ['rate-limit', 'logger', 'maintenance', 'chat-filter', 'ignore-old', 'error-reporter', 'analytics', 'feature-flags']) {
      const w = findPlugin(id)!.build();
      expect(w.packages).toEqual(['@teactjs/plugins']);
      expect(w.imports[0].from).toBe('@teactjs/plugins');
      expect(w.plugins).toHaveLength(1);
    }
    expect(findPlugin('rate-limit')!.build().plugins[0]).toStartWith('rateLimit(');
    // broadcast is a helper, not a plugin: install + instructions only
    const broadcast = findPlugin('broadcast')!.build();
    expect(broadcast.packages).toEqual(['@teactjs/plugins']);
    expect(broadcast.plugins).toEqual([]);
    expect(broadcast.notes.join('\n')).toContain('createBroadcaster');
  });

  test('redis client variants pick the right client library', () => {
    const redis = findPlugin('redis')!;
    expect(redis.build('ioredis').packages).toContain('ioredis');
    expect(redis.build('redis').packages).toContain('redis');
    expect(redis.build('upstash').packages).toContain('@upstash/redis');
    const bun = redis.build('bun');
    expect(bun.packages).toEqual(['@teactjs/redis', '@teactjs/storage']);
    expect(bun.imports.find((i) => i.from === 'bun')?.named).toEqual(['RedisClient']);
    expect(() => redis.build('memcached')).toThrow(UnknownClientError);
  });

  test('postgres client variants', () => {
    const pg = findPlugin('postgres')!;
    expect(pg.build().packages).toContain('pg');
    expect(pg.build('postgres').packages).toContain('postgres');
    expect(pg.build('neon').packages).toContain('@neondatabase/serverless');
    expect(pg.build('neon').setup[0]).toContain('neon(');
    expect(pg.build().env).toEqual(['DATABASE_URL']);
  });

  test('resolveWiring merges several plugins and dedupes packages/imports', () => {
    const { wiring, ids } = resolveWiring(['logger', 'rate-limit', 'logger', 'storage']);
    expect(ids).toEqual(['logger', 'rate-limit', 'storage']);
    expect(wiring.packages).toEqual(['@teactjs/plugins', '@teactjs/storage']);
    const pluginsImport = wiring.imports.find((i) => i.from === '@teactjs/plugins')!;
    expect(pluginsImport.named).toEqual(['logger', 'rateLimit']);
    expect(() => resolveWiring(['bogus'])).toThrow(/Unknown plugin/);
    expect(() => resolveWiring(['redis', 'postgres'], 'pg')).toThrow(/ambiguous/);
  });

  test('snippet contains imports, setup and the plugins array', () => {
    const snippet = renderSnippet(findPlugin('redis')!.build('ioredis'));
    expect(snippet).toContain("import Redis from 'ioredis';");
    expect(snippet).toContain("import { RedisDriver, redisPlugin } from '@teactjs/redis';");
    expect(snippet).toContain('const redis = new Redis(process.env.REDIS_URL!);');
    expect(snippet).toContain('    storagePlugin({ driver: redisDriver }),');
    expect(renderImport({ from: 'x', default: 'X', named: ['a'] })).toBe("import X, { a } from 'x';");
  });

  test('mergeWirings keeps first default import', () => {
    const w = mergeWirings([
      { packages: ['a'], imports: [{ from: 'm', named: ['x'] }], setup: [], plugins: ['x()'], env: [], notes: [] },
      { packages: ['a', 'b'], imports: [{ from: 'm', default: 'M', named: ['x', 'y'] }], setup: [], plugins: ['x()', 'y()'], env: [], notes: [] },
    ]);
    expect(w.packages).toEqual(['a', 'b']);
    expect(w.imports).toEqual([{ from: 'm', named: ['x', 'y'], default: 'M' }]);
    expect(w.plugins).toEqual(['x()', 'y()']);
  });
});

const ENTRY = `import { createBot } from '@teactjs/core';
import { storagePlugin } from '@teactjs/storage';

function App() { return null; }

export const bot = createBot({
  component: App,
  plugins: [
    storagePlugin({ driver: 'file' }), // keep me
  ],
});

if (import.meta.main) bot.start();
`;

describe('teact add · source wiring', () => {
  test('appends to an existing plugins array, merges imports, adds setup before createBot', () => {
    const w = resolveWiring(['logger', 'redis'], 'ioredis').wiring;
    const r = wireSource(ENTRY, w);
    if (!r.ok) throw new Error(r.reason);
    expect(r.source).toContain("import { logger } from '@teactjs/plugins';");
    expect(r.source).toContain("import Redis from 'ioredis';");
    expect(r.source).toContain("    storagePlugin({ driver: 'file' }), // keep me\n    logger(),\n    redisPlugin({ client: redis, closeOnStop: true }),\n  ],");
    expect(r.source.indexOf('const redis = new Redis')).toBeLessThan(r.source.indexOf('createBot({'));
    // storagePlugin is already registered with other options → reported, not duplicated
    expect(r.skipped).toEqual(['storagePlugin({ driver: redisDriver })']);
    expect(r.source.match(/storagePlugin\(/g)).toHaveLength(1);
  });

  test('is idempotent', () => {
    const w = resolveWiring(['logger']).wiring;
    const once = wireSource(ENTRY, w);
    if (!once.ok) throw new Error(once.reason);
    const twice = wireSource(once.source, w);
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.changes).toEqual([]);
    expect(twice.source).toBe(once.source);
  });

  test('merges named imports into an existing import from the same module', () => {
    const src = `import { storagePlugin } from '@teactjs/storage';\nimport { createBot } from '@teactjs/core';\nexport const bot = createBot({ component: App });\n`;
    const r = wireSource(src, { packages: [], imports: [{ from: '@teactjs/storage', named: ['storagePlugin', 'createSessionStore'] }], setup: [], plugins: ['x()'], env: [], notes: [] });
    if (!r.ok) throw new Error(r.reason);
    expect(r.source).toContain("import { storagePlugin, createSessionStore } from '@teactjs/storage';");
    expect(r.source).toContain('createBot({ plugins: [x()], component: App })');
  });

  test('adds a plugins key to a multi-line createBot object without one', () => {
    const src = `import { createBot } from '@teactjs/core';\n\nexport const bot = createBot({\n  component: App,\n});\n`;
    const r = wireSource(src, resolveWiring(['logger']).wiring);
    if (!r.ok) throw new Error(r.reason);
    expect(r.source).toContain('createBot({\n  plugins: [\n    logger(),\n  ],\n  component: App,\n});');
  });

  test('fills an empty plugins array and handles single-line arrays', () => {
    const empty = wireSource(`import { createBot } from 'x';\ncreateBot({\n  plugins: [],\n});\n`, resolveWiring(['logger']).wiring);
    expect(empty.ok && empty.source).toContain('  plugins: [\n    logger(),\n  ],');
    const inline = wireSource(`import { createBot } from 'x';\ncreateBot({ plugins: [a()] });\n`, resolveWiring(['logger']).wiring);
    expect(inline.ok && inline.source).toContain('plugins: [a(), logger()]');
  });

  test('ignores createBot / plugins inside strings and comments', () => {
    const src = `import { createBot } from 'x';\n// createBot({ plugins: [] })\nconst s = "createBot(";\nexport const bot = createBot({\n  component: App,\n});\n`;
    const r = wireSource(src, resolveWiring(['logger']).wiring);
    if (!r.ok) throw new Error(r.reason);
    expect(r.source).toContain('// createBot({ plugins: [] })');
    expect(r.source).toContain('createBot({\n  plugins: [\n    logger(),');
  });

  test('bails out on unexpected shapes', () => {
    const w = resolveWiring(['logger']).wiring;
    const cases: Array<[string, RegExp]> = [
      [`import { createBot } from 'x';\nconst opts = {};\ncreateBot(opts);\n`, /not called with an object literal/],
      [`import { createBot } from 'x';\ncreateBot({ plugins });\n`, /shorthand/],
      [`import { createBot } from 'x';\ncreateBot({ plugins: getPlugins() });\n`, /not an array literal/],
      [`import { createBot } from 'x';\ncreateBot({});\ncreateBot({});\n`, /2 createBot/],
      [`export const x = 1;\n`, /no createBot/],
    ];
    for (const [src, reason] of cases) {
      const r = wireSource(src, w);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    }
    // name clash with an existing binding from another module
    const clash = wireSource(`import Redis from 'other';\nimport { createBot } from 'x';\ncreateBot({});\n`, resolveWiring(['redis'], 'ioredis').wiring);
    expect(clash.ok).toBe(false);
  });

  test('defineConfig target for teact.config.ts', () => {
    const src = `import { defineConfig } from '@teactjs/core';\n\nexport default defineConfig({\n  mode: 'polling',\n});\n`;
    const r = wireSource(src, resolveWiring(['logger']).wiring, 'defineConfig');
    if (!r.ok) throw new Error(r.reason);
    expect(r.source).toContain("defineConfig({\n  plugins: [\n    logger(),\n  ],\n  mode: 'polling',");
  });

  test('maskSource blanks strings, templates and comments but keeps length', () => {
    const src = "a('x{') /* { */ `t ${b('}')} u` // }\n{";
    const m = maskSource(src);
    expect(m.length).toBe(src.length);
    expect(m.split('{').length - 1).toBe(2); // `${` and the final `{`
    expect(m).toContain("b(' ')");
  });
});

describe('teact add · project helpers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'teact-add-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('detectPackageManager uses lockfiles, walking up for workspaces', () => {
    mkdirSync(join(dir, 'app'));
    writeFileSync(join(dir, 'app', 'package.json'), '{}');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(join(dir, 'app'))).toBe('pnpm');
    writeFileSync(join(dir, 'app', 'yarn.lock'), '');
    expect(detectPackageManager(join(dir, 'app'))).toBe('yarn');
    writeFileSync(join(dir, 'app', 'bun.lock'), '');
    expect(detectPackageManager(join(dir, 'app'))).toBe('bun');
  });

  test('detectPackageManager falls back to packageManager field', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'npm@10.0.0' }));
    expect(detectPackageManager(dir)).toBe('npm');
  });

  test('installCommand per manager', () => {
    expect(installCommand('npm', ['a'])).toEqual(['npm', 'install', 'a']);
    expect(installCommand('bun', ['a', 'b'])).toEqual(['bun', 'add', 'a', 'b']);
    expect(installCommand('pnpm', ['a'], true)).toEqual(['pnpm', 'add', '-D', 'a']);
  });

  test('missingPackages skips declared deps', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@teactjs/storage': '1' } }));
    expect(missingPackages(dir, ['@teactjs/storage', '@teactjs/redis'])).toEqual(['@teactjs/redis']);
  });

  test('parseDotEnv and NO_COLOR', () => {
    expect(parseDotEnv('# c\nA=1\nexport B="x y"\nC=z # note\n')).toEqual({ A: '1', B: 'x y', C: 'z' });
    expect(colorEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
    expect(colorEnabled({ FORCE_COLOR: '1' }, false)).toBe(true);
  });
});

describe('wireSource safety', () => {
  test('refuses when an apostrophe in JSX text hides an existing plugins key', () => {
    const { wireSource } = require('../packages/cli/src/add/wire');
    const src = `import { createBot } from '@teactjs/core';
export const bot = createBot({
  component: () => <M>Don't panic</M>, plugins: [logger()],
  adapter,
});
`;
    const r = wireSource(src, findPlugin('rate-limit')!.build(undefined as any));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(/could not reliably locate `plugins`/);
  });
});
