#!/usr/bin/env bun
/**
 * Post-build step for a package's declaration output (run from the package directory,
 * after `tsc --emitDeclarationOnly --outDir dist`).
 *
 * The root tsconfig maps `@teactjs/*` to sibling sources, so tsc emits declarations under
 * `dist/<pkg>/src/` plus copies of every package it imports (`dist/core/src/…`). This:
 *   1. moves the package's own declarations to `dist/` (so `types` is `dist/index.d.ts`),
 *   2. deletes the copied trees of other workspace packages (they import each other by
 *      bare `@teactjs/x` specifiers, so the copies are dead weight),
 *   3. adds explicit `.js` / `/index.js` extensions to relative specifiers, which
 *      `moduleResolution: node16/nodenext` requires in a `"type": "module"` package,
 *   4. removes `.d.ts.map` files (they point at `src/`, which isn't published).
 */
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync, renameSync, mkdirSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';

const pkgDir = process.cwd();
const dist = join(pkgDir, 'dist');
const name = basename(pkgDir);
const workspacePackages = readdirSync(resolve(pkgDir, '..'));

if (!existsSync(dist)) {
  console.error(`[fix-dts] ${name}: no dist/ — run the build first`);
  process.exit(1);
}

// 1. Hoist the package's own declaration tree to dist/.
const ownRoot = [join(dist, name, 'src'), join(dist, 'src')].find((p) => existsSync(p));
if (ownRoot) {
  const move = (from: string, to: string) => {
    for (const entry of readdirSync(from)) {
      const src = join(from, entry);
      const dst = join(to, entry);
      if (statSync(src).isDirectory()) {
        mkdirSync(dst, { recursive: true });
        move(src, dst);
      } else {
        renameSync(src, dst);
      }
    }
  };
  move(ownRoot, dist);
  rmSync(ownRoot, { recursive: true, force: true });
  if (ownRoot === join(dist, name, 'src')) rmSync(join(dist, name), { recursive: true, force: true });
}

// 2. Drop declaration copies of other workspace packages.
for (const other of workspacePackages) {
  if (other === name) continue;
  const copy = join(dist, other, 'src');
  if (existsSync(copy)) rmSync(join(dist, other), { recursive: true, force: true });
}

// 3 + 4. Walk the remaining declarations.
const walk = (dir: string, out: string[] = []) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const SPECIFIER = /((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]*)(['"])/g;
let rewritten = 0;
for (const file of walk(dist)) {
  if (file.endsWith('.d.ts.map')) {
    rmSync(file);
    continue;
  }
  if (!file.endsWith('.d.ts')) continue;
  const src = readFileSync(file, 'utf-8');
  const out = src
    .replace(SPECIFIER, (match, pre: string, spec: string, post: string) => {
      if (/\.(js|mjs|cjs|json)$/.test(spec)) return match;
      const base = resolve(dirname(file), spec);
      if (existsSync(`${base}.d.ts`)) return `${pre}${spec}.js${post}`;
      if (existsSync(join(base, 'index.d.ts'))) return `${pre}${spec.replace(/\/$/, '')}/index.js${post}`;
      return match;
    })
    .replace(/\n\/\/# sourceMappingURL=.*$/m, '');
  if (out !== src) {
    writeFileSync(file, out);
    rewritten++;
  }
}

if (!existsSync(join(dist, 'index.d.ts'))) {
  console.error(`[fix-dts] ${name}: dist/index.d.ts is missing after the rewrite`);
  process.exit(1);
}
console.log(`[fix-dts] ${name}: declarations at dist/index.d.ts (${rewritten} files rewritten)`);
