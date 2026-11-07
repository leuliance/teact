import * as p from '@clack/prompts';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { findProjectRoot, readEnvVar } from '../utils';

export async function infoCommand(): Promise<void> {
  p.intro('Teact Project Info');

  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : 'not found';
  const nodeVersion = process.version;

  const root = findProjectRoot();

  const pkg = await import('../../package.json');
  p.log.info(`Teact CLI:  ${pkg.version}`);
  p.log.info(`Bun:        ${bunVersion}`);
  p.log.info(`Node:       ${nodeVersion}`);
  p.log.info(`Platform:   ${process.platform} ${process.arch}`);

  if (root) {
    const envPath = resolve(root, '.env');
    const hasEnv = existsSync(envPath);
    const hasToken = !!readEnvVar(root, 'TELEGRAM_BOT_TOKEN');

    p.log.info(`Project:    ${root}`);
    p.log.info(`.env:       ${hasEnv ? 'found' : 'missing'}`);
    p.log.info(`Bot token:  ${hasToken ? 'configured' : 'not set'}`);
  } else {
    p.log.warn('No Teact project found in current directory');
  }

  p.outro('Done');
}
