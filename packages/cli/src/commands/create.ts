import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import * as p from '@clack/prompts';
import { getTemplate } from '../templates/bot-templates';

interface CreateOptions {
  template?: string;
  install?: boolean;
  pm?: string;
  features?: string;
}

const isTTY = process.stdin.isTTY;

export async function createCommand(name: string, opts: CreateOptions): Promise<void> {
  const dir = resolve(process.cwd(), name);

  if (existsSync(dir)) {
    p.log.error(`Directory "${name}" already exists`);
    process.exit(1);
  }

  p.intro(`Creating Teact project: ${name}`);

  let template: string;
  let features: string[];
  let pm: string;

  if (isTTY && !opts.template) {
    const t = await p.select({
      message: 'Pick a template',
      options: [
        { value: 'router', label: 'Router', hint: 'multi-page bot with navigation (recommended)' },
        { value: 'counter', label: 'Counter', hint: 'simple stateful counter bot' },
        { value: 'full', label: 'Full-Stack', hint: 'router + storage + conversations + streaming + auth' },
        { value: 'empty', label: 'Empty', hint: 'minimal setup' },
      ],
    });
    if (p.isCancel(t)) { p.cancel('Cancelled'); process.exit(0); }
    template = t as string;

    const f = await p.multiselect({
      message: 'Select features',
      options: [
        { value: 'storage', label: 'Storage', hint: 'persistent state with useStorage' },
        { value: 'conversations', label: 'Conversations', hint: 'multi-step flows with Grammy' },
        { value: 'streaming', label: 'Streaming', hint: 'live text updates with useStream' },
        { value: 'auth', label: 'Auth', hint: 'role-based access control' },
        { value: 'i18n', label: 'Internationalization', hint: 'multi-language support with i18next' },
        { value: 'payments', label: 'Payments', hint: 'Telegram payments with useInvoice' },
      ],
      initialValues: template === 'full' ? ['storage', 'conversations', 'streaming', 'auth'] : [],
      required: false,
    });
    if (p.isCancel(f)) { p.cancel('Cancelled'); process.exit(0); }
    features = f as string[];

    const m = await p.select({
      message: 'Package manager',
      options: [
        { value: 'bun', label: 'bun', hint: 'recommended' },
        { value: 'npm', label: 'npm' },
        { value: 'pnpm', label: 'pnpm' },
      ],
    });
    if (p.isCancel(m)) { p.cancel('Cancelled'); process.exit(0); }
    pm = m as string;
  } else {
    template = opts.template ?? 'router';
    features = opts.features ? opts.features.split(',') : (template === 'full' ? ['storage', 'conversations', 'streaming', 'auth'] : []);
    pm = opts.pm ?? 'bun';
  }

  const spin = p.spinner();
  spin.start('Generating project');

  mkdirSync(join(dir, 'src', 'components'), { recursive: true });

  const packageJson: Record<string, unknown> = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'teact dev',
      build: 'teact build',
      start: 'bun run dist/index.js',
    },
    dependencies: {
      '@teact/core': '^0.1.0-alpha.1',
      '@teact/ui': '^0.1.0-alpha.1',
      '@teact/telegram': '^0.1.0-alpha.1',
      '@teact/cli': '^0.1.0-alpha.1',
      react: '^18.3.0',
      ...(features.includes('storage') ? { '@teact/storage': '^0.1.0-alpha.1' } : {}),
      ...(features.includes('i18n') ? { 'i18next': '^23.0.0', 'react-i18next': '^15.0.0' } : {}),
    },
    devDependencies: {
      typescript: '^5.7.0',
      '@types/bun': 'latest',
      '@types/react': '^18.3.0',
    },
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022'],
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
      rootDir: 'src',
      resolveJsonModule: true,
    },
    include: ['src'],
  };

  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  writeFileSync(join(dir, '.env'), 'TELEGRAM_BOT_TOKEN=\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n.teact/\n*.log\n');

  const files = getTemplate(template, features);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(dir, filePath);
    mkdirSync(resolve(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  spin.stop('Project generated');

  if (opts.install !== false) {
    const installSpin = p.spinner();
    installSpin.start(`Installing dependencies with ${pm}`);
    try {
      const proc = Bun.spawnSync([pm, 'install'], { cwd: dir, stderr: 'pipe', stdout: 'pipe' });
      if (proc.exitCode === 0) {
        installSpin.stop('Dependencies installed');
      } else {
        installSpin.stop('Install failed — run manually');
      }
    } catch {
      installSpin.stop('Install failed — run manually');
    }
  }

  p.note(
    [
      `cd ${name}`,
      '# Add your TELEGRAM_BOT_TOKEN to .env',
      `${pm === 'bun' ? 'bun' : pm + ' run'} dev`,
    ].join('\n'),
    'Next steps',
  );

  p.outro('Happy building!');
}
