import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { heading, success, error, warn, log, findProjectRoot } from '../utils';

export async function doctorCommand(): Promise<void> {
  heading('Teact Doctor - Environment Check');

  let issues = 0;

  // Check Bun
  try {
    const proc = Bun.spawnSync(['bun', '--version']);
    const version = new TextDecoder().decode(proc.stdout).trim();
    success(`Bun ${version}`);
  } catch {
    error('Bun not found');
    log('  → Install Bun: curl -fsSL https://bun.sh/install | bash');
    log('  → Or visit: https://bun.sh');
    issues++;
  }

  // Check TypeScript
  try {
    const proc = Bun.spawnSync(['tsc', '--version']);
    const version = new TextDecoder().decode(proc.stdout).trim();
    success(`${version}`);
  } catch {
    warn('TypeScript not found globally');
    log('  → Install: bun add -g typescript');
    log('  → Or rely on local: bun add -d typescript');
  }

  // Check project
  const root = findProjectRoot();
  if (root) {
    success(`Teact project found: ${root}`);

    const checks: Array<{ path: string; label: string; fix: string }> = [
      { path: 'package.json', label: 'package.json', fix: 'Run: bun init' },
      { path: 'tsconfig.json', label: 'tsconfig.json', fix: 'Run: teact create <name> or add tsconfig.json manually' },
      { path: 'teact.config.ts', label: 'teact.config.ts', fix: 'Optional — create one with defineConfig() from @teactjs/core' },
      { path: 'src/index.tsx', label: 'Entry file (src/index.tsx)', fix: 'Create src/index.tsx as your bot entry point' },
      { path: '.env', label: '.env file', fix: 'Create .env with: echo "TELEGRAM_BOT_TOKEN=" > .env' },
      { path: 'node_modules', label: 'node_modules (dependencies installed)', fix: 'Run: bun install' },
    ];

    const hasTsxEntry = existsSync(resolve(root, 'src/index.tsx'));
    const hasTsEntry = existsSync(resolve(root, 'src/index.ts'));

    for (const { path, label, fix } of checks) {
      if (path === 'src/index.tsx') {
        if (hasTsxEntry || hasTsEntry) {
          success(hasTsxEntry ? 'Entry file (src/index.tsx)' : 'Entry file (src/index.ts)');
        } else {
          warn(`${label} not found`);
          log(`  → ${fix}`);
          issues++;
        }
        continue;
      }

      if (existsSync(resolve(root, path))) {
        success(label);
      } else if (path === 'teact.config.ts') {
        // Optional, just inform
        log(`  ℹ ${label} not found (optional)`);
      } else {
        warn(`${label} not found`);
        log(`  → ${fix}`);
        issues++;
      }
    }

    // Check for bot token
    if (existsSync(resolve(root, '.env'))) {
      const envContent = readFileSync(resolve(root, '.env'), 'utf-8');
      if (envContent.includes('TELEGRAM_BOT_TOKEN=') && !envContent.match(/TELEGRAM_BOT_TOKEN=\S+/)) {
        warn('TELEGRAM_BOT_TOKEN is empty in .env');
        log('  → Get a token from @BotFather on Telegram');
        log('  → Then set it: TELEGRAM_BOT_TOKEN=123456:ABC-DEF...');
        issues++;
      } else if (envContent.match(/TELEGRAM_BOT_TOKEN=\S+/)) {
        const m = envContent.match(/TELEGRAM_BOT_TOKEN=(\S+)/);
        const token = m?.[1] ?? '';
        // Telegram bot tokens look like: <digits>:<35-char base64-ish>
        if (/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
          success('TELEGRAM_BOT_TOKEN is set (valid format)');
        } else {
          warn('TELEGRAM_BOT_TOKEN is set but does not look like a valid Telegram token');
          log('  → Expected format: 123456789:ABCdef... (from @BotFather)');
          issues++;
        }
      }
    }

    // Check Teact dependencies
    try {
      const pkgContent = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
      const deps = { ...pkgContent.dependencies, ...pkgContent.devDependencies };
      const teactPkgs = Object.keys(deps).filter(d => d.startsWith('@teactjs/'));
      if (teactPkgs.length > 0) {
        success(`Teact packages: ${teactPkgs.join(', ')}`);
      } else {
        warn('No @teactjs/* packages found in dependencies');
        log('  → Run: bun add @teactjs/core @teactjs/ui @teactjs/telegram');
        issues++;
      }
    } catch {}
  } else {
    log('No Teact project found in current directory');
    log('  → Create one with: teact create my-bot');
  }

  console.log('');
  if (issues === 0) {
    success('All checks passed!');
  } else {
    warn(`${issues} issue(s) found — see suggestions above`);
  }
}
