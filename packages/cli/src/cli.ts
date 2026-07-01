import { Command } from 'commander';
import { createCommand } from './commands/create';
import { devCommand } from './commands/dev';
import { buildCommand } from './commands/build';
import { startCommand } from './commands/start';
import { typecheckCommand } from './commands/typecheck';
import { deployCommand } from './commands/deploy';
import { webhookCommand } from './commands/webhook';
import { generateCommand } from './commands/generate';
import { doctorCommand } from './commands/doctor';
import { infoCommand } from './commands/info';
import { routesCommand } from './commands/routes';
import pkg from '../package.json';

const VERSION = pkg.version;

const program = new Command()
  .name('teact')
  .description('Teact — Universal React-Based Bot Framework')
  .version(VERSION);

program
  .command('create <name>')
  .description('Create a new Teact bot project')
  .option('-t, --template <template>', 'Project template (router, counter, full, empty)')
  .option('-f, --features <features>', 'Comma-separated features (storage,conversations,streaming,auth,payments); i18n is always included')
  .option('--pm <manager>', 'Package manager (bun, npm, pnpm)')
  .option('--no-install', 'Skip dependency installation')
  .action(async (name: string, opts) => {
    await createCommand(name, opts);
  });

program
  .command('dev')
  .description('Start development server with hot reload')
  .option('-e, --entry <file>', 'Entry file')
  .action(async (opts) => {
    await devCommand(opts);
  });

program
  .command('build')
  .description('Build for production')
  .option('-e, --entry <file>', 'Entry file')
  .option('--no-minify', 'Disable minification')
  .option('--no-sourcemap', 'Disable source maps')
  .action(async (opts) => {
    await buildCommand(opts);
  });

program
  .command('start')
  .description('Run the production build (dist/index.js) — run `teact build` first')
  .action(async () => {
    await startCommand();
  });

program
  .command('typecheck')
  .description('Type-check the project with tsc --noEmit')
  .action(async () => {
    await typecheckCommand();
  });

program
  .command('generate <type> <name>')
  .alias('g')
  .description('Generate component, hook, or plugin')
  .action(async (type: string, name: string) => {
    await generateCommand(type, name);
  });

program
  .command('doctor')
  .description('Check your environment and project setup')
  .action(async () => {
    await doctorCommand();
  });

program
  .command('info')
  .description('Print project and environment info')
  .action(async () => {
    await infoCommand();
  });

program
  .command('routes')
  .description('List registered routes in the project')
  .action(async () => {
    await routesCommand();
  });

program
  .command('deploy [target]')
  .description('Scaffold & deploy to a serverless platform (default: cloudflare)')
  .option('--run', 'Run the platform deploy command (e.g. wrangler deploy)')
  .action(async (target: string | undefined, opts) => {
    await deployCommand(target, opts);
  });

program
  .command('webhook <action> [url]')
  .description('Manage the Telegram webhook: set <url> | delete | info')
  .option('--secret <token>', 'Secret token to verify webhook requests')
  .option('--drop', 'Drop pending updates')
  .action(async (action: string, url: string | undefined, opts) => {
    await webhookCommand(action, url, opts);
  });

export { program };
