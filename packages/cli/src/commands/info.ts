import { resolve } from 'path';
import { existsSync } from 'fs';
import pkg from '../../package.json';
import { c, heading, findProjectRoot, findEntry, readEnvVar, detectPackageManager, findViteConfig } from '../utils';

export async function infoCommand(): Promise<void> {
  heading('Teact Project Info');

  const row = (k: string, v: string) => console.log(`  ${c.dim(k.padEnd(14))}${v}`);
  row('Teact CLI', pkg.version);
  row('Bun', typeof Bun !== 'undefined' ? Bun.version : 'not found');
  row('Node API', process.version);
  row('Platform', `${process.platform} ${process.arch}`);

  const root = findProjectRoot();
  if (!root) {
    console.log(`\n  ${c.yellow('⚠')} No Teact project found in current directory`);
    return;
  }
  const { teactVersions } = await import('./doctor');
  const versions = teactVersions(root);
  console.log('');
  row('Project', root);
  row('Entry', findEntry(root) ?? c.yellow('not found'));
  row('Package mgr', detectPackageManager(root));
  row('Pipeline', findViteConfig(root) ? 'vite (vite.config found)' : 'bun (dev: bun --watch, build: Bun.build)');
  row('.env', existsSync(resolve(root, '.env')) ? 'found' : c.yellow('missing'));
  row('Bot token', readEnvVar(root, 'TELEGRAM_BOT_TOKEN') ? 'configured' : c.yellow('not set'));
  const names = Object.keys(versions);
  if (names.length) row('Packages', names.map((n) => `${n.slice(9)}@${versions[n]}`).join(', '));
}
