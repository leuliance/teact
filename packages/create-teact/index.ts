#!/usr/bin/env bun

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import * as p from '@clack/prompts';

const args = process.argv.slice(2);

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

  const template = await p.select({
    message: 'Pick a template',
    options: [
      { value: 'router', label: 'Router', hint: 'multi-page bot with navigation (recommended)' },
      { value: 'counter', label: 'Counter', hint: 'simple stateful counter' },
      { value: 'full', label: 'Full-Stack', hint: 'router + all features pre-wired' },
      { value: 'empty', label: 'Empty', hint: 'bare minimum' },
    ],
  }) as string;

  if (p.isCancel(template)) { p.cancel('Cancelled'); process.exit(0); }

  const features = await p.multiselect({
    message: 'Select features',
    options: [
      { value: 'storage', label: 'Storage', hint: 'persistent state with useStorage' },
      { value: 'conversations', label: 'Conversations', hint: 'multi-step flows' },
      { value: 'streaming', label: 'Streaming', hint: 'live text updates with useStream' },
      { value: 'auth', label: 'Auth', hint: 'role-based access + useAuthSession' },
      { value: 'i18n', label: 'Internationalization', hint: 'multi-language with i18next' },
      { value: 'payments', label: 'Payments', hint: 'Telegram payments with useInvoice' },
    ],
    initialValues: template === 'full' ? ['storage', 'conversations', 'streaming', 'auth', 'i18n', 'payments'] : [],
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

  const has = (f: string) => template === 'full' || features.includes(f);

  const deps: Record<string, string> = {
    '@teactjs/core': '^0.1.0-alpha.1',
    '@teactjs/ui': '^0.1.0-alpha.1',
    '@teactjs/telegram': '^0.1.0-alpha.1',
    '@teactjs/cli': '^0.1.0-alpha.1',
    react: '^19.0.0',
  };
  if (has('storage')) deps['@teactjs/storage'] = '^0.1.0-alpha.1';
  if (has('i18n')) {
    deps['i18next'] = '^23.0.0';
    deps['react-i18next'] = '^15.0.0';
  }

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
    dependencies: deps,
    devDependencies: {
      typescript: '^5.7.0',
      '@types/bun': 'latest',
      '@types/react': '^19.0.0',
    },
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
    include: ['src'],
  }, null, 2));

  let envContent = 'TELEGRAM_BOT_TOKEN=\n';
  if (has('payments')) envContent += 'PAYMENT_PROVIDER_TOKEN=\n';

  writeFileSync(join(dir, '.env'), envContent);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n.teact/\n*.log\n.DS_Store\n');

  const files = buildFiles(template, features);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(dir, filePath);
    mkdirSync(resolve(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  spin.stop('Project generated');

  if (shouldInstall) {
    const installSpin = p.spinner();
    installSpin.start(`Installing with ${pm}`);
    try {
      const proc = Bun.spawnSync([pm, 'install'], { cwd: dir, stderr: 'pipe', stdout: 'pipe' });
      installSpin.stop(proc.exitCode === 0 ? 'Dependencies installed' : 'Install failed — run manually');
    } catch {
      installSpin.stop('Install failed — run manually');
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

// ---- File generators ----

function buildFiles(template: string, features: string[]): Record<string, string> {
  const has = (f: string) => template === 'full' || features.includes(f);

  if (template === 'counter') return counterFiles();
  if (template === 'empty') return emptyFiles();

  return routerFiles(has);
}

function emptyFiles(): Record<string, string> {
  return {
    'src/index.tsx': `import { createBot } from '@teactjs/core';
import { Message } from '@teactjs/ui';
import { TelegramAdapter } from '@teactjs/telegram';

function App() {
  return <Message text="Hello from Teact!" />;
}

const bot = createBot({
  component: App,
  adapter: new TelegramAdapter(),
  commands: { start: { description: 'Start the bot' } },
});

bot.start();
`,
  };
}

function counterFiles(): Record<string, string> {
  return {
    'src/index.tsx': `import { useState } from 'react';
import { createBot } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';
import { TelegramAdapter } from '@teactjs/telegram';

function App() {
  const [count, setCount] = useState(0);

  return (
    <Message text={\`Count: \${count}\`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="-1" onClick={() => setCount(c => c - 1)} />
          <Button text={\`[ \${count} ]\`} onClick={() => {}} />
          <Button text="+1" onClick={() => setCount(c => c + 1)} />
        </ButtonRow>
        <ButtonRow>
          <Button text="Reset" onClick={() => setCount(0)} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}

const bot = createBot({
  component: App,
  adapter: new TelegramAdapter(),
  commands: { start: { description: 'Start the counter' } },
});

bot.start();
`,
  };
}

function routerFiles(has: (f: string) => boolean): Record<string, string> {
  const files: Record<string, string> = {};

  // ---- teact.config.ts ----
  const configPlugins: string[] = [];
  const configImportsCore: string[] = ['defineConfig'];
  const configImportsTelegram: string[] = [];
  const configImportsStorage: string[] = [];

  if (has('storage')) {
    configImportsStorage.push('storagePlugin');
    configPlugins.push("storagePlugin({ driver: 'file', path: '.teact/storage.json' })");
  }
  if (has('conversations')) {
    configImportsTelegram.push('conversationsPlugin');
    configPlugins.push('conversationsPlugin()');
  }
  if (has('streaming')) {
    configImportsTelegram.push('streamPlugin');
    configPlugins.push('streamPlugin()');
  }
  if (has('auth')) {
    configImportsCore.push('authPlugin');
    configPlugins.push('authPlugin({ admins: [] })');
  }

  let configSrc = `import { ${configImportsCore.join(', ')} } from '@teactjs/core';\n`;
  if (configImportsTelegram.length > 0) {
    configSrc += `import { ${configImportsTelegram.join(', ')} } from '@teactjs/telegram';\n`;
  }
  if (configImportsStorage.length > 0) {
    configSrc += `import { ${configImportsStorage.join(', ')} } from '@teactjs/storage';\n`;
  }
  configSrc += `\nexport default defineConfig({\n  mode: 'polling',\n`;
  if (configPlugins.length > 0) {
    configSrc += `\n  plugins: [\n    ${configPlugins.join(',\n    ')},\n  ],\n`;
  }
  configSrc += `});\n`;
  files['teact.config.ts'] = configSrc;

  // ---- Routes and pages ----
  const routes: Array<{ path: string; component: string; file: string }> = [
    { path: '/', component: 'MainMenu', file: './pages/MainMenu' },
    { path: '/about', component: 'About', file: './pages/About' },
  ];
  const commands: Record<string, string> = {
    start: "'/'",
    about: "'/about'",
  };

  if (has('storage')) {
    routes.push({ path: '/settings', component: 'Settings', file: './pages/Settings' });
    commands['settings'] = "'/settings'";
  }
  if (has('streaming')) {
    routes.push({ path: '/stream', component: 'StreamDemo', file: './pages/StreamDemo' });
    commands['stream'] = "'/stream'";
  }
  if (has('i18n')) {
    routes.push({ path: '/language', component: 'LanguagePage', file: './pages/LanguagePage' });
    commands['language'] = "'/language'";
  }
  if (has('payments')) {
    routes.push({ path: '/store', component: 'StorePage', file: './pages/StorePage' });
    commands['store'] = "'/store'";
  }

  // ---- src/index.tsx ----
  let indexSrc = `import React from 'react';\n`;
  indexSrc += `import { createBot, createRouter${has('i18n') ? ', createI18n' : ''} } from '@teactjs/core';\n`;
  indexSrc += `import { TelegramAdapter } from '@teactjs/telegram';\n\n`;

  for (const r of routes) {
    indexSrc += `import { ${r.component} } from '${r.file}';\n`;
  }

  if (has('i18n')) {
    indexSrc += `\nimport en from './locales/en.json';\nimport am from './locales/am.json';\n`;
    indexSrc += `\nconst i18n = createI18n({\n  defaultLocale: 'en',\n  resources: {\n    en: { translation: en },\n    am: { translation: am },\n  },\n});\n`;
  }

  indexSrc += `\nconst router = createRouter({\n`;
  for (const r of routes) {
    indexSrc += `  '${r.path}': ${r.component},\n`;
  }
  indexSrc += `});\n`;

  indexSrc += `\nconst bot = createBot({\n  adapter: new TelegramAdapter(),\n  router,\n`;
  if (has('i18n')) {
    indexSrc += `  providers: ({ children }) => (\n    <i18n.Provider>{children}</i18n.Provider>\n  ),\n`;
  }
  indexSrc += `  commands: {\n`;
  for (const [cmd, route] of Object.entries(commands)) {
    indexSrc += `    ${cmd}: { description: '${cmd.charAt(0).toUpperCase() + cmd.slice(1)}', route: ${route} },\n`;
  }
  indexSrc += `  },\n});\n\nbot.start();\n`;
  files['src/index.tsx'] = indexSrc;

  // ---- MainMenu ----
  const menuButtons: string[] = [];
  menuButtons.push(`          <Button text="ℹ️ About" onClick={() => navigate('/about')} />`);
  if (has('storage')) menuButtons.push(`          <Button text="⚙️ Settings" onClick={() => navigate('/settings')} />`);
  if (has('streaming')) menuButtons.push(`          <Button text="⚡ Stream Demo" onClick={() => navigate('/stream')} />`);
  if (has('i18n')) menuButtons.push(`          <Button text="🌐 Language" onClick={() => navigate('/language')} />`);
  if (has('payments')) menuButtons.push(`          <Button text="💎 Store" onClick={() => navigate('/store')} />`);

  const menuRows: string[] = [];
  for (let i = 0; i < menuButtons.length; i += 2) {
    const pair = menuButtons.slice(i, i + 2);
    menuRows.push(`        <ButtonRow>\n${pair.join('\n')}\n        </ButtonRow>`);
  }

  files['src/pages/MainMenu.tsx'] = `import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function MainMenu() {
  const navigate = useNavigate();

  return (
    <Message text="🤖 Welcome!\\n\\nPick an option:">
      <InlineKeyboard>
${menuRows.join('\n')}
      </InlineKeyboard>
    </Message>
  );
}
`;

  // ---- About ----
  files['src/pages/About.tsx'] = `import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function About() {
  const navigate = useNavigate();

  return (
    <Message text="ℹ️ About\\n\\nBuilt with Teact — React for Telegram bots.\\nhttps://github.com/leuliance/teact">
      <InlineKeyboard>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
`;

  // ---- Settings (storage) ----
  if (has('storage')) {
    files['src/pages/Settings.tsx'] = `import { useNavigate } from '@teactjs/core';
import { useStorage } from '@teactjs/storage';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function Settings() {
  const navigate = useNavigate();
  const [theme, setTheme] = useStorage('theme', 'light');
  const [notify, setNotify] = useStorage('notifications', true);

  return (
    <Message text={\`⚙️ Settings\\n\\n🎨 Theme: \${theme}\\n🔔 Notifications: \${notify ? 'On' : 'Off'}\`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text={\`🎨 \${theme}\`} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} />
          <Button text={\`🔔 \${notify ? 'On' : 'Off'}\`} onClick={() => setNotify(n => !n)} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
`;
  }

  // ---- StreamDemo ----
  if (has('streaming')) {
    files['src/pages/StreamDemo.tsx'] = `import { useNavigate, useStream } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function* generateText() {
  yield 'Generating';
  await delay(500);
  yield ' your ';
  await delay(500);
  yield 'response...\\n\\n';
  await delay(600);
  yield 'Hello from the stream!';
}

export function StreamDemo() {
  const navigate = useNavigate();
  const { text, isStreaming, stream } = useStream({ throttleMs: 400 });

  return (
    <Message text={text || '⚡ Stream Demo\\n\\nWatch text generate live!'}>
      <InlineKeyboard>
        <ButtonRow>
          <Button
            text={isStreaming ? '⏳ Streaming...' : '▶️ Start Stream'}
            onClick={() => { if (!isStreaming) stream(generateText()); }}
          />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
`;
  }

  // ---- LanguagePage (i18n) ----
  if (has('i18n')) {
    files['src/locales/en.json'] = `{
  "welcome": "Welcome!",
  "about": "About this bot",
  "settings": "Settings",
  "language": "Language",
  "back": "Back"
}
`;
    files['src/locales/am.json'] = `{
  "welcome": "እንኳን ደህና መጡ!",
  "about": "ስለ ቦት",
  "settings": "ቅንብሮች",
  "language": "ቋንቋ",
  "back": "ተመለስ"
}
`;
    files['src/pages/LanguagePage.tsx'] = `import { useNavigate, useLocale } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function LanguagePage() {
  const navigate = useNavigate();
  const { t, locale, setLocale } = useLocale();

  return (
    <Message text={\`🌐 \${t('language')}\\n\\nCurrent: \${locale}\`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="🇬🇧 English" onClick={() => setLocale('en')} />
          <Button text="🇪🇹 አማርኛ" onClick={() => setLocale('am')} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
`;
  }

  // ---- StorePage (payments) ----
  if (has('payments')) {
    files['src/pages/StorePage.tsx'] = `import { useNavigate, useInvoice } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow, Alert } from '@teactjs/ui';

export function StorePage() {
  const navigate = useNavigate();
  const invoice = useInvoice({
    title: 'Premium Access',
    description: 'Unlock all features for 30 days',
    payload: 'premium-30d',
    providerToken: process.env.PAYMENT_PROVIDER_TOKEN ?? '',
    currency: 'USD',
    prices: [{ label: 'Premium (30 days)', amount: 499 }],
  });

  if (invoice.status === 'success') {
    return (
      <Message text={\`✅ Payment successful!\\n\\nCharge ID: \${invoice.receipt?.telegramPaymentChargeId}\`}>
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  if (invoice.status === 'failed') {
    return (
      <>
        <Alert variant="error" title="Payment Failed">
          {invoice.error ?? 'Unknown error'}
        </Alert>
        <Message text="Please check your payment configuration.">
          <InlineKeyboard>
            <ButtonRow>
              <Button text="🔄 Retry" onClick={invoice.send} />
              <Button text="🏠 Menu" onClick={() => navigate('/')} />
            </ButtonRow>
          </InlineKeyboard>
        </Message>
      </>
    );
  }

  return (
    <Message text={\`💎 Premium Access\\n\\nUnlock all features.\\n💰 Price: $4.99\${invoice.status === 'pending' ? '\\n\\n⏳ Processing...' : ''}\`}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="💳 Buy — $4.99" onClick={invoice.send} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
`;
  }

  return files;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
