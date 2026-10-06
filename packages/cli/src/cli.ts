import { Command } from 'commander';
import pkg from '../package.json';
import { c } from './utils';

// Every command module is loaded lazily inside its action, so `teact --version`,
// `teact --help` and light commands never pay for Vite, esbuild or @clack/prompts.

const VERSION = pkg.version;

function examples(...lines: string[]): string {
  return `\n${c.bold('Examples:')}\n${lines.map((l) => `  ${c.dim('$')} ${l}`).join('\n')}\n`;
}

const program = new Command()
  .name('teact')
  .description('Teact — Universal React-Based Bot Framework')
  .version(VERSION, '-v, --version')
  .configureHelp({
    styleTitle: (s) => c.bold(s),
    styleCommandText: (s) => c.cyan(s),
    styleSubcommandText: (s) => c.cyan(s),
    styleOptionText: (s) => c.green(s),
  })
  .showSuggestionAfterError()
  .addHelpText('after', examples(
    'teact create my-bot',
    'teact dev',
    'teact add redis --client ioredis',
    'teact build && teact start',
    'teact doctor',
  ));

program
  .command('create <name>')
  .description('Create a new Teact bot project')
  .option('-t, --template <template>', 'Project template (starter, counter, showcase, empty)')
  .option('-f, --features <features>', 'Comma-separated features (storage,conversations,streaming,auth,payments); i18n is always included')
  .option('--db <driver>', 'Storage backend when the storage feature is on (memory, file, sqlite, redis, postgres)')
  .option('--pm <manager>', 'Package manager (bun, npm, pnpm)')
  .option('--no-install', 'Skip dependency installation')
  .addHelpText('after', examples(
    'teact create my-bot',
    'teact create my-bot -t showcase --pm bun',
    'teact create my-bot -t starter -f storage,auth --db sqlite --no-install',
  ))
  .action(async (name: string, opts) => {
    const { createCommand } = await import('./commands/create');
    await createCommand(name, opts);
  });

program
  .command('dev')
  .description('Start the bot with reload on change (Bun-native by default)')
  .option('-e, --entry <file>', 'Entry file (default: src/index.tsx)')
  .option('--hot', 'Reload in-process with bun --hot instead of restarting with bun --watch')
  .option('--vite', 'Use the vite-node pipeline (automatic when a vite.config.* exists)')
  .option('--clear', 'Clear the screen on every reload')
  .addHelpText('after', examples(
    'teact dev',
    'teact dev --hot --clear',
    'teact dev --vite -e src/bot.tsx',
  ))
  .action(async (opts) => {
    const { devCommand } = await import('./commands/dev');
    await devCommand(opts);
  });

program
  .command('build')
  .description('Build for production into dist/index.js (Bun.build by default)')
  .option('-e, --entry <file>', 'Entry file (default: src/index.tsx)')
  .option('--target <runtime>', 'Runtime to target: bun or node', 'bun')
  .option('--standalone', 'Bundle dependencies too (grammY and DB clients stay external)')
  .option('--vite', 'Build with Vite (automatic when a vite.config.* exists)')
  .option('--no-minify', 'Disable minification')
  .option('--no-sourcemap', 'Disable source maps')
  .addHelpText('after', examples(
    'teact build',
    'teact build --target node --no-minify',
    'teact build --vite',
  ))
  .action(async (opts) => {
    const { buildCommand } = await import('./commands/build');
    await buildCommand(opts);
  });

program
  .command('start')
  .description('Run the production build (dist/index.js) — run `teact build` first')
  .action(async () => {
    const { startCommand } = await import('./commands/start');
    await startCommand();
  });

program
  .command('add [plugins...]')
  .description('Install Teact plugins/integrations and wire them up (no args: list them)')
  .option('--client <client>', 'Client library variant (e.g. redis: ioredis|redis|upstash|bun; postgres: pg|postgres|neon)')
  .option('--dry-run', 'Print what would happen without installing or editing files')
  .option('--no-install', 'Skip package installation')
  .option('--no-wire', 'Do not edit source files; just print the snippet')
  .addHelpText('after', examples(
    'teact add',
    'teact add redis --client ioredis',
    'teact add postgres --client neon --dry-run',
    'teact add rate-limit logger i18n',
  ))
  .action(async (plugins: string[], opts) => {
    const { addCommand } = await import('./commands/add');
    await addCommand(plugins, opts);
  });

program
  .command('typecheck')
  .description('Type-check the project with tsc --noEmit')
  .action(async () => {
    const { typecheckCommand } = await import('./commands/typecheck');
    await typecheckCommand();
  });

program
  .command('generate <type> <name>')
  .alias('g')
  .description('Generate component, hook, or plugin')
  .addHelpText('after', examples('teact g component ProfileCard', 'teact g hook usePoints', 'teact g plugin audit'))
  .action(async (type: string, name: string) => {
    const { generateCommand } = await import('./commands/generate');
    await generateCommand(type, name);
  });

program
  .command('doctor')
  .description('Check your environment, project setup, bot token and dependencies')
  .option('--offline', 'Skip network checks (token validity, webhook status)')
  .addHelpText('after', examples('teact doctor', 'teact doctor --offline'))
  .action(async (opts) => {
    const { doctorCommand } = await import('./commands/doctor');
    await doctorCommand(opts);
  });

program
  .command('info')
  .description('Print project and environment info')
  .action(async () => {
    const { infoCommand } = await import('./commands/info');
    await infoCommand();
  });

program
  .command('routes')
  .description('List routes declared with createRouter() (with commands and guards)')
  .option('--json', 'Print routes as JSON')
  .action(async (opts) => {
    const { routesCommand } = await import('./commands/routes');
    await routesCommand(opts);
  });

program
  .command('deploy [target]')
  .description('Scaffold & deploy to a serverless platform (default: cloudflare)')
  .option('--run', 'Run the platform deploy command (e.g. wrangler deploy)')
  .addHelpText('after', examples('teact deploy', 'teact deploy cloudflare --run'))
  .action(async (target: string | undefined, opts) => {
    const { deployCommand } = await import('./commands/deploy');
    await deployCommand(target, opts);
  });

program
  .command('webhook <action> [url]')
  .description('Manage the Telegram webhook: set <url> | delete | info')
  .option('--secret <token>', 'Secret token to verify webhook requests')
  .option('--drop', 'Drop pending updates')
  .addHelpText('after', examples(
    'teact webhook info',
    'teact webhook set https://my-bot.workers.dev --secret $WEBHOOK_SECRET',
    'teact webhook delete --drop',
  ))
  .action(async (action: string, url: string | undefined, opts) => {
    const { webhookCommand } = await import('./commands/webhook');
    await webhookCommand(action, url, opts);
  });

export { program };
