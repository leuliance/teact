import { existsSync } from 'fs';
import { resolve } from 'path';

export function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      flags[key] = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

export function findProjectRoot(from = process.cwd()): string | null {
  let dir = from;
  while (dir !== '/') {
    if (existsSync(resolve(dir, 'teact.config.ts')) || existsSync(resolve(dir, 'teact.config.js'))) {
      return dir;
    }
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = require(pkgPath);
        if (pkg.dependencies?.['@teact/core'] || pkg.devDependencies?.['@teact/core']
          || pkg.dependencies?.['@teact/react'] || pkg.devDependencies?.['@teact/react']) {
          return dir;
        }
      } catch {}
    }
    dir = resolve(dir, '..');
  }
  return null;
}

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

export function log(message: string): void {
  console.log(`${COLORS.cyan}[teact]${COLORS.reset} ${message}`);
}

export function success(message: string): void {
  console.log(`${COLORS.green}✓${COLORS.reset} ${message}`);
}

export function warn(message: string): void {
  console.log(`${COLORS.yellow}⚠${COLORS.reset} ${message}`);
}

export function error(message: string): void {
  console.log(`${COLORS.red}✗${COLORS.reset} ${message}`);
}

export function heading(message: string): void {
  console.log(`\n${COLORS.bold}${COLORS.magenta}${message}${COLORS.reset}\n`);
}
