import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import * as p from '@clack/prompts';
import {
  buildDependencies,
  buildEnvContent,
  defaultFeaturesForTemplate,
  getTemplateFiles,
  normalizeTemplate,
  TEMPLATE_SELECT_OPTIONS,
  FEATURE_SELECT_OPTIONS,
  type TemplateId,
} from '../lib';

interface CreateOptions {
  template?: string;
  install?: boolean;
  pm?: string;
  features?: string;
}

const isTTY = process.stdin.isTTY;

async function runInstall(pm: string, cwd: string): Promise<number> {
  const proc = Bun.spawn([pm, 'install'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  return proc.exited.then(() => proc.exitCode ?? 1);
}

export async function createCommand(name: string, opts: CreateOptions): Promise<void> {
  const dir = resolve(process.cwd(), name);

  if (existsSync(dir)) {
    p.log.error(`Directory "${name}" already exists`);
    process.exit(1);
  }

  p.intro(`Creating Teact project: ${name}`);

  let template: TemplateId;
  let features: string[];
  let pm: string;

  if (isTTY && !opts.template) {
    const t = await p.select({
      message: 'Pick a template',
      options: [...TEMPLATE_SELECT_OPTIONS],
    });
    if (p.isCancel(t)) { p.cancel('Cancelled'); process.exit(0); }
    template = normalizeTemplate(t as string);

    const initial = defaultFeaturesForTemplate(template);
    const f = await p.multiselect({
      message: 'Plugins & integrations (toggle what you need)',
      options: [...FEATURE_SELECT_OPTIONS],
      initialValues: initial,
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
    template = normalizeTemplate(opts.template ?? 'starter');
    features = opts.features
      ? opts.features.split(',').map((s) => s.trim()).filter(Boolean)
      : defaultFeaturesForTemplate(template);
    pm = opts.pm ?? 'bun';
  }

  const spin = p.spinner();
  spin.start('Generating project');

  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });

  const { dependencies, devDependencies } = buildDependencies(template, features);

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
    dependencies,
    devDependencies,
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
      resolveJsonModule: true,
    },
    include: ['src', 'teact.config.ts'],
  };

  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  writeFileSync(join(dir, '.env'), buildEnvContent(features));
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n.teact/\n*.log\n.DS_Store\n');

  const files = getTemplateFiles(template, features);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(dir, filePath);
    mkdirSync(resolve(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  spin.stop('Project generated');

  if (opts.install !== false) {
    p.log.info(`Installing dependencies with ${pm}…`);
    const code = await runInstall(pm, dir);
    if (code === 0) {
      p.log.success('Dependencies installed');
    } else {
      p.log.warn('Install exited with an error — run the install command manually in the project folder');
    }
  }

  const runCmd = pm === 'bun' ? 'bun dev' : `${pm} run dev`;
  p.note(
    [
      `cd ${name}`,
      '# Add TELEGRAM_BOT_TOKEN to .env',
      runCmd,
    ].join('\n'),
    'Next steps',
  );

  p.outro('Happy building!');
}
