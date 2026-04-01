#!/usr/bin/env bun

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
} from './lib';

const args = process.argv.slice(2);

async function runInstall(pm: string, cwd: string): Promise<number> {
  const proc = Bun.spawn([pm, 'install'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  return proc.exited.then(() => proc.exitCode ?? 1);
}

async function main() {
  p.intro('create-teact');

  const nameArg = args[0];
  const name = nameArg ?? (await p.text({
    message: 'Project name',
    placeholder: 'my-bot',
    validate(v) {
      if (!v) return 'Name is required';
      if (/[^a-z0-9-_]/.test(v)) return 'Use lowercase letters, numbers, hyphens, or underscores';
    },
  }) as string);

  if (p.isCancel(name)) { p.cancel('Cancelled'); process.exit(0); }

  const dir = resolve(process.cwd(), name);
  if (existsSync(dir)) {
    p.log.error(`Directory "${name}" already exists`);
    process.exit(1);
  }

  const templateRaw = await p.select({
    message: 'Pick a template',
    options: [...TEMPLATE_SELECT_OPTIONS],
  }) as string;

  if (p.isCancel(templateRaw)) { p.cancel('Cancelled'); process.exit(0); }

  const template: TemplateId = normalizeTemplate(templateRaw);

  const initial = defaultFeaturesForTemplate(template);
  const features = await p.multiselect({
    message: 'Plugins & integrations (toggle what you need)',
    options: [...FEATURE_SELECT_OPTIONS],
    initialValues: initial,
    required: false,
  }) as string[];

  if (p.isCancel(features)) { p.cancel('Cancelled'); process.exit(0); }

  const pm = await p.select({
    message: 'Package manager',
    options: [
      { value: 'bun', label: 'bun', hint: 'recommended' },
      { value: 'npm', label: 'npm' },
      { value: 'pnpm', label: 'pnpm' },
    ],
  }) as string;

  if (p.isCancel(pm)) { p.cancel('Cancelled'); process.exit(0); }

  const shouldInstall = await p.confirm({ message: 'Install dependencies?' });
  if (p.isCancel(shouldInstall)) { p.cancel('Cancelled'); process.exit(0); }

  const spin = p.spinner();
  spin.start('Generating project');

  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });

  const { dependencies, devDependencies } = buildDependencies(template, features);

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
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
  }, null, 2));

  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
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
  }, null, 2));

  writeFileSync(join(dir, '.env'), buildEnvContent(features));
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n.teact/\n*.log\n.DS_Store\n');

  const files = getTemplateFiles(template, features);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(dir, filePath);
    mkdirSync(resolve(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  spin.stop('Project generated');

  if (shouldInstall) {
    p.log.info(`Installing dependencies with ${pm}…`);
    const code = await runInstall(pm, dir);
    if (code === 0) {
      p.log.success('Dependencies installed');
    } else {
      p.log.warn('Install failed — run the package manager manually in the project folder');
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
