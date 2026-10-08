import { resolve, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { REGISTRY, findPlugin, mergeWirings, renderSnippet, UnknownClientError, type Wiring } from '../add/registry';
import { wireSource } from '../add/wire';
import {
  c, heading, log, success, warn, info, hint, fail,
  detectPackageManager, installCommand, findEntry, readJson, requireProjectRoot,
} from '../utils';

export interface AddOptions {
  client?: string;
  dryRun?: boolean;
  install?: boolean;
  wire?: boolean;
}

export function listPlugins(): string {
  const width = Math.max(...REGISTRY.map((e) => e.id.length)) + 2;
  const lines = REGISTRY.map((e) => {
    const clients = e.clients ? c.dim(`  --client ${Object.keys(e.clients).join('|')}`) : '';
    return `  ${c.cyan(e.id.padEnd(width))}${e.description}${clients}`;
  });
  return lines.join('\n');
}

/** Resolve plugin names (+ --client) into one merged wiring. Throws on unknown names/clients. */
export function resolveWiring(names: string[], client?: string): { wiring: Wiring; ids: string[] } {
  const ids: string[] = [];
  const wirings: Wiring[] = [];
  const withClients = names.map(findPlugin).filter((e) => e?.clients);
  if (client && withClients.length > 1) {
    throw new Error('--client is ambiguous when adding several integrations that take a client — add them one at a time');
  }
  for (const name of names) {
    const entry = findPlugin(name);
    if (!entry) throw new Error(`Unknown plugin "${name}". Run \`teact add\` to see what's available.`);
    if (ids.includes(entry.id)) continue;
    ids.push(entry.id);
    wirings.push(entry.build(entry.clients ? client : undefined));
  }
  return { wiring: mergeWirings(wirings), ids };
}

/** Packages from `wanted` not yet declared in package.json. */
export function missingPackages(projectRoot: string, wanted: string[]): string[] {
  const pkg = readJson(resolve(projectRoot, 'package.json')) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  return wanted.filter((p) => !deps[p]);
}

export async function addCommand(names: string[], opts: AddOptions): Promise<void> {
  if (names.length === 0) {
    heading('Available integrations');
    console.log(listPlugins());
    console.log(`\n  ${c.dim('Usage:')} teact add <name...> [--client <variant>] [--dry-run]\n`);
    return;
  }

  const projectRoot = requireProjectRoot();
  let resolved: ReturnType<typeof resolveWiring>;
  try {
    resolved = resolveWiring(names, opts.client);
  } catch (err) {
    if (err instanceof UnknownClientError) fail(err.message);
    fail((err as Error).message);
  }
  const { wiring, ids } = resolved;
  const dry = !!opts.dryRun;

  heading(`teact add ${ids.join(' ')}${dry ? c.dim('  (dry run)') : ''}`);

  // ---- install ----
  const pm = detectPackageManager(projectRoot);
  const toInstall = missingPackages(projectRoot, wiring.packages);
  if (toInstall.length === 0) {
    success(`Packages already in package.json: ${wiring.packages.join(', ')}`);
  } else if (opts.install === false || dry) {
    info(`${dry ? 'Would run' : 'Install with'}: ${c.bold(installCommand(pm, toInstall).join(' '))}`);
  } else {
    const cmd = installCommand(pm, toInstall);
    log(`Running ${c.bold(cmd.join(' '))}`);
    const proc = Bun.spawn(cmd, { cwd: projectRoot, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
    const code = await proc.exited;
    if (code !== 0) fail(`${pm} exited with code ${code}`, `Run it yourself: ${cmd.join(' ')}`);
    success(`Installed ${toInstall.join(', ')}`);
  }

  // ---- wire ----
  const snippet = renderSnippet(wiring);
  const hasCode = wiring.imports.length > 0 || wiring.plugins.length > 0;
  if (hasCode) {
    let wired = false;
    if (opts.wire !== false) {
      const candidates: Array<{ file: string; call: 'createBot' | 'defineConfig' }> = [];
      const entry = findEntry(projectRoot);
      if (entry) candidates.push({ file: resolve(projectRoot, entry), call: 'createBot' });
      // createBot() may live outside the entry (e.g. src/bot.tsx): wire that file rather than
      // falling back to teact.config.ts, which would register the plugin a second time.
      for (const file of findCreateBotFiles(projectRoot)) {
        if (!candidates.some((c) => c.file === file)) candidates.push({ file, call: 'createBot' });
      }
      for (const cfg of ['teact.config.ts', 'teact.config.js']) {
        if (existsSync(resolve(projectRoot, cfg))) candidates.push({ file: resolve(projectRoot, cfg), call: 'defineConfig' });
      }
      const reasons: string[] = [];
      for (const { file, call } of candidates) {
        const src = readFileSync(file, 'utf-8');
        const result = wireSource(src, wiring, call);
        const rel = relative(projectRoot, file);
        if (!result.ok) {
          reasons.push(`${rel}: ${result.reason}`);
          // Fall back to teact.config.ts only when the entry has no createBot(…) at all.
          if (call === 'createBot' && result.reason.startsWith('no createBot')) continue;
          break;
        }
        if (result.changes.length === 0) {
          success(`${rel} already wired — nothing to change`);
        } else if (dry) {
          info(`Would edit ${c.bold(rel)}:`);
          for (const ch of result.changes) console.log(`    ${c.green('+')} ${ch}`);
        } else {
          writeFileSync(file, result.source);
          success(`Updated ${c.bold(rel)}`);
          for (const ch of result.changes) console.log(`    ${c.green('+')} ${ch}`);
        }
        for (const p of result.skipped) {
          warn(`${rel} already registers ${p.split('(')[0]}(…) — update it to: ${c.bold(p)}`);
        }
        wired = true;
        break;
      }
      if (!wired && reasons.length) {
        warn('Could not wire it automatically:');
        for (const r of reasons) hint(r);
      }
    }
    if (!wired) {
      console.log(`\n${c.bold('Add this to your entry (src/index.tsx):')}\n`);
      console.log(snippet.split('\n').map((l) => `  ${l}`).join('\n'));
      console.log('');
    }
  }

  if (wiring.env.length) {
    const envFile = resolve(projectRoot, '.env');
    const content = existsSync(envFile) ? readFileSync(envFile, 'utf-8') : '';
    const missing = wiring.env.filter((v) => !new RegExp(`^\\s*${v}\\s*=`, 'm').test(content));
    if (missing.length) {
      if (dry) info(`Would add to .env: ${missing.join(', ')}`);
      else {
        writeFileSync(envFile, content + (content && !content.endsWith('\n') ? '\n' : '') + missing.map((v) => `${v}=\n`).join(''));
        success(`Added ${missing.join(', ')} to .env — fill in the value${missing.length > 1 ? 's' : ''}`);
      }
    }
  }

  for (const note of wiring.notes) info(note);
  if (!dry) console.log(`\n${c.dim('Next:')} teact dev`);
}

/** Source files under src/ that call createBot(…), skipping node_modules/dist. */
function findCreateBotFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) walk(p, depth + 1);
      else if (/\.(tsx?|jsx?)$/.test(name) && /\bcreateBot\s*\(/.test(readFileSync(p, 'utf-8'))) out.push(p);
    }
  };
  walk(resolve(root, 'src'), 0);
  return out;
}
