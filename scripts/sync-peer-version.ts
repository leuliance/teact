#!/usr/bin/env bun
/**
 * Keeps the hardcoded TEACT_PEER_VERSION constant in the scaffolder templates in
 * sync with the real package version.
 *
 * `changeset version` bumps every package.json (they're a fixed group), but it has
 * no idea about `TEACT_PEER_VERSION` — a plain string constant inside generate.ts
 * that decides which @teactjs/* version a freshly-scaffolded project depends on.
 * If it drifts, `bun create teact` generates projects pinned to an old version.
 *
 * This script reads the canonical version (create-teact/package.json — same as every
 * other package since they're fixed) and rewrites the constant in both copies of
 * generate.ts. Run automatically by `bun run version` after `changeset version`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkgJsonPath = join(repoRoot, 'packages/create-teact/package.json');
const version = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version as string;
if (!version) {
  console.error('[sync-peer-version] Could not read version from create-teact/package.json');
  process.exit(1);
}

const peerRange = `^${version}`;

// The canonical template source. The cli copy (cli/src/lib) is regenerated from this
// on the cli `prebuild`, but we update it too so it's never stale on disk.
const targets = [
  'packages/create-teact/lib/generate.ts',
  'packages/cli/src/lib/generate.ts',
];

const CONST_RE = /(export const TEACT_PEER_VERSION = ')(\^[^']+)(';)/;

let changed = 0;
for (const rel of targets) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, 'utf-8');
  if (!CONST_RE.test(src)) {
    console.warn(`[sync-peer-version] TEACT_PEER_VERSION not found in ${rel} — skipped`);
    continue;
  }
  const next = src.replace(CONST_RE, `$1${peerRange}$3`);
  if (next !== src) {
    writeFileSync(abs, next);
    changed++;
    console.log(`[sync-peer-version] ${rel} → ${peerRange}`);
  }
}

console.log(`[sync-peer-version] done (${peerRange}, ${changed} file(s) updated)`);
