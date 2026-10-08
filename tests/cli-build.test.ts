import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { bunBuild, isExternalImport } from '../packages/cli/src/commands/build';
import { resolveDevRunner, bunDevArgs } from '../packages/cli/src/commands/dev';
import { findPackageCopies, compareVersions } from '../packages/cli/src/commands/doctor';

const REPO = resolve(import.meta.dir, '..');
const BIN = join(REPO, 'packages/cli/src/bin.ts');

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'teact-build-'));
  // Resolve react & friends from the monorepo at runtime.
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', dependencies: { '@teactjs/core': '*', react: '*' } }));
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'lib', 'greet.ts'), `export const greet = (n: string): string => 'hello ' + n;\n`);
  writeFileSync(
    join(dir, 'src', 'index.tsx'),
    `import { join } from 'node:path';
import { isValidElement } from 'react';
import { greet } from '@/lib/greet';
const el = <div title={greet('jsx')} />;
console.log('[fixture]', greet('build'), isValidElement(el), el.props.title, typeof join);
`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('teact build · Bun.build', () => {
  test('externals: builtins and packages external, @teactjs bundled, standalone bundles deps', () => {
    expect(isExternalImport('node:fs')).toBe(true);
    expect(isExternalImport('fs')).toBe(true);
    expect(isExternalImport('bun:sqlite')).toBe(true);
    expect(isExternalImport('react/jsx-runtime')).toBe(true);
    expect(isExternalImport('@teactjs/core')).toBe(false);
    expect(isExternalImport('@teactjs/ui/components')).toBe(false);
    expect(isExternalImport('zod', true)).toBe(false);
    expect(isExternalImport('grammy', true)).toBe(true);
    expect(isExternalImport('@grammyjs/conversations', true)).toBe(true);
    expect(isExternalImport('pg', true)).toBe(true);
  });

  test('builds a fixture into dist/index.js that runs', async () => {
    const result = await bunBuild({ root: dir, entry: 'src/index.tsx' });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
    const out = join(dir, 'dist', 'index.js');
    expect(existsSync(out)).toBe(true);
    expect(existsSync(out + '.map')).toBe(true);
    const code = readFileSync(out, 'utf-8');
    expect(code).toMatch(/from\s*"react\/jsx-(dev-)?runtime"/); // automatic JSX runtime, kept external
    expect(code).not.toContain('function greet'); // minified + bundled

    const proc = Bun.spawnSync([process.execPath, out], { cwd: dir });
    expect(proc.stdout.toString()).toContain('[fixture] hello build true hello jsx function');
  });

  test('--no-minify --no-sourcemap --target node', async () => {
    rmSync(join(dir, 'dist'), { recursive: true, force: true });
    const result = await bunBuild({ root: dir, entry: 'src/index.tsx', minify: false, sourcemap: false, target: 'node' });
    expect(result.success).toBe(true);
    expect(existsSync(join(dir, 'dist', 'index.js.map'))).toBe(false);
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf-8')).toContain('"hello "');
  });
});

describe('teact dev · runner selection', () => {
  test('bun --watch by default, --hot opt-in, vite when asked / configured / not Bun', () => {
    expect(resolveDevRunner({}, false, true)).toBe('bun-watch');
    expect(resolveDevRunner({ hot: true }, false, true)).toBe('bun-hot');
    expect(resolveDevRunner({ vite: true }, false, true)).toBe('vite');
    expect(resolveDevRunner({ hot: true }, true, true)).toBe('vite');
    expect(resolveDevRunner({}, false, false)).toBe('vite');
  });

  test('bun args', () => {
    expect(bunDevArgs('/p/src/index.tsx', 'bun-watch')).toEqual(['--watch', '--no-clear-screen', '/p/src/index.tsx']);
    expect(bunDevArgs('/p/src/index.tsx', 'bun-hot', true)).toEqual(['--hot', '/p/src/index.tsx']);
  });

  test('teact dev starts the entry under bun --watch with .env loaded', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'teact-dev-'));
    try {
      writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'dev', dependencies: { '@teactjs/core': '*' } }));
      writeFileSync(join(proj, '.env'), 'FIXTURE_VALUE=from-dotenv\n');
      mkdirSync(join(proj, 'src'));
      writeFileSync(join(proj, 'src', 'index.ts'), `console.log('[dev-fixture]', process.env.FIXTURE_VALUE, process.env.NODE_ENV, import.meta.main);\nsetInterval(() => {}, 1000);\n`);
      const proc = Bun.spawn([process.execPath, BIN, 'dev'], { cwd: proj, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', NODE_ENV: '' } });
      let out = '';
      const deadline = Date.now() + 8000;
      const reader = proc.stdout.getReader();
      while (!out.includes('[dev-fixture]') && Date.now() < deadline) {
        const { value, done } = await Promise.race([reader.read(), Bun.sleep(8000).then(() => ({ value: undefined, done: true }))]);
        if (done) break;
        out += new TextDecoder().decode(value);
      }
      proc.kill('SIGKILL');
      expect(out).toContain('bun --watch');
      expect(out).toContain('[dev-fixture] from-dotenv development true');
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

describe('teact CLI · lazy loading', () => {
  // Records which heavy deps ended up in the module registry when the process exits.
  const preload = () => {
    const p = join(dir, 'trace-preload.ts');
    writeFileSync(p, `process.on('exit', () => {
  const heavy = Object.keys(require.cache).filter((k) => /node_modules\\/.*(vite|esbuild|@clack)/.test(k));
  process.stderr.write('HEAVY_MODULES=' + heavy.length + '\\n');
});\n`);
    return p;
  };

  for (const args of [['--version'], ['--help'], ['webhook', 'bogus'], ['add'], ['doctor', '--help']]) {
    test(`\`teact ${args.join(' ')}\` loads no vite/esbuild/@clack`, () => {
      const proc = Bun.spawnSync([process.execPath, '--preload', preload(), BIN, ...args], { cwd: REPO, env: { ...process.env, NO_COLOR: '1' } });
      expect(proc.stderr.toString()).toContain('HEAVY_MODULES=0');
    });
  }

  test('the trace detects vite when it is loaded (sanity check)', () => {
    const proc = Bun.spawnSync([process.execPath, '--preload', preload(), '-e', "await import('vite')"], { cwd: join(REPO, 'packages/cli') });
    expect(proc.stderr.toString()).not.toContain('HEAVY_MODULES=0');
  });

  test('published bundle (bun build --splitting) keeps heavy deps out of the startup graph', async () => {
    const outdir = join(dir, 'cli-dist');
    const result = await Bun.build({
      entrypoints: [join(REPO, 'packages/cli/src/bin.ts')],
      outdir,
      splitting: true,
      format: 'esm',
      target: 'bun',
      external: ['vite', 'vite-node', 'esbuild', 'commander', '@clack/prompts'],
    });
    expect(result.success).toBe(true);
    // Walk static imports from bin.js; none of them may pull vite/@clack/commander.
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(join(outdir, file), 'utf-8');
      expect(code).not.toMatch(/^import[^;]*from\s*["'](vite|vite-node[^"']*|@clack\/prompts|commander|esbuild)["']/m);
      for (const m of code.matchAll(/^import[^;]*?from\s*["']\.\/([^"']+)["']/gm)) walk(m[1]);
    };
    walk('bin.js');
  });

  test('--version prints the package version', () => {
    const proc = Bun.spawnSync([process.execPath, BIN, '--version']);
    const pkg = JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf-8'));
    expect(proc.stdout.toString().trim()).toBe(pkg.version);
  });
});

describe('teact doctor · helpers', () => {
  test('compareVersions', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareVersions('1.4.2', '1.1.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
  });

  test('findPackageCopies spots duplicate React versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'teact-doctor-'));
    try {
      const pkg = (p: string, v: string) => {
        mkdirSync(p, { recursive: true });
        writeFileSync(join(p, 'package.json'), JSON.stringify({ name: 'react', version: v }));
      };
      pkg(join(root, 'node_modules', 'react'), '19.0.0');
      expect([...findPackageCopies(root).keys()]).toEqual(['19.0.0']);
      pkg(join(root, 'node_modules', 'some-lib', 'node_modules', 'react'), '18.3.1');
      pkg(join(root, 'node_modules', '@scope', 'ui', 'node_modules', 'react'), '18.3.1');
      const copies = findPackageCopies(root);
      expect([...copies.keys()].sort()).toEqual(['18.3.1', '19.0.0']);
      expect(copies.get('18.3.1')).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
