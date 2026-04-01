import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dir = dirname(fileURLToPath(import.meta.url));

function asset(name: string): string {
  return readFileSync(join(_dir, 'assets', name), 'utf-8');
}

/** Published @teactjs/* version range for generated package.json */
export const TEACT_PEER_VERSION = '^0.1.0-alpha.11';

export type TemplateId = 'empty' | 'counter' | 'starter' | 'showcase';

/** Normalize legacy CLI values */
export function normalizeTemplate(t: string): TemplateId {
  if (t === 'full') return 'showcase';
  if (t === 'router') return 'starter';
  if (t === 'empty' || t === 'counter' || t === 'starter' || t === 'showcase') return t;
  return 'starter';
}

export const TEMPLATE_SELECT_OPTIONS = [
  { value: 'starter', label: 'Starter', hint: 'Main menu + About; add routes via features below' },
  { value: 'showcase', label: 'Showcase', hint: 'Pokedex, stream, component demo, guards, deep links (same as examples/showcase-bot)' },
  { value: 'counter', label: 'Counter', hint: 'single-screen state demo' },
  { value: 'empty', label: 'Empty', hint: 'one Message, no router' },
] as const;

export const FEATURE_SELECT_OPTIONS = [
  { value: 'storage', label: 'Storage', hint: 'persistent state with useStorage' },
  { value: 'conversations', label: 'Conversations', hint: 'multi-step flows with Grammy' },
  { value: 'streaming', label: 'Streaming', hint: 'live text updates with useStream' },
  { value: 'auth', label: 'Auth', hint: 'useAuthSession + route guards' },
  { value: 'i18n', label: 'Internationalization', hint: 'i18next + useLocale' },
  { value: 'payments', label: 'Payments', hint: 'Telegram invoices with useInvoice' },
] as const;

export const SHOWCASE_DEFAULT_FEATURES = [
  'storage',
  'conversations',
  'streaming',
  'auth',
  'i18n',
  'payments',
] as const;

export function defaultFeaturesForTemplate(template: TemplateId): string[] {
  if (template === 'showcase') return [...SHOWCASE_DEFAULT_FEATURES];
  return [];
}

function hasFeature(features: string[], f: string): boolean {
  return features.includes(f);
}

function buildTeactConfig(features: string[]): string {
  const configPlugins: string[] = [];
  const configImportsCore: string[] = ['defineConfig'];
  const configImportsTelegram: string[] = [];
  const configImportsStorage: string[] = [];

  if (hasFeature(features, 'storage')) {
    configImportsStorage.push('storagePlugin');
    configPlugins.push("storagePlugin({ driver: 'file', path: '.teact/storage.json' })");
  }
  if (hasFeature(features, 'conversations')) {
    configImportsTelegram.push('conversationsPlugin');
    configPlugins.push('conversationsPlugin()');
  }
  if (hasFeature(features, 'streaming')) {
    configImportsTelegram.push('streamPlugin');
    configPlugins.push('streamPlugin()');
  }
  if (hasFeature(features, 'auth')) {
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
  return configSrc;
}

export function buildDependencies(template: TemplateId, features: string[]): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const deps: Record<string, string> = {
    '@teactjs/core': TEACT_PEER_VERSION,
    '@teactjs/ui': TEACT_PEER_VERSION,
    '@teactjs/telegram': TEACT_PEER_VERSION,
    '@teactjs/cli': TEACT_PEER_VERSION,
    react: '^19.0.0',
  };
  if (template === 'showcase') {
    deps['@tanstack/react-query'] = '^5.95.2';
  }
  if (hasFeature(features, 'storage')) deps['@teactjs/storage'] = TEACT_PEER_VERSION;
  if (hasFeature(features, 'i18n')) {
    deps['i18next'] = '^23.0.0';
    deps['react-i18next'] = '^15.0.0';
  }
  return {
    dependencies: deps,
    devDependencies: {
      typescript: '^5.7.0',
      '@types/bun': 'latest',
      '@types/react': '^19.0.0',
    },
  };
}

export function buildEnvContent(features: string[]): string {
  let env = 'TELEGRAM_BOT_TOKEN=\n';
  if (hasFeature(features, 'payments')) env += 'PAYMENT_PROVIDER_TOKEN=\n';
  return env;
}

const SHARED_FILES: Record<string, string> = {
  '.gitignore': `node_modules/
dist/
.teact/
.env
*.log
.DS_Store
`,
  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "teact.config.ts"]
}
`,
};

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

function starterFiles(features: string[]): Record<string, string> {
  const has = (f: string) => hasFeature(features, f);
  const files: Record<string, string> = {};

  files['teact.config.ts'] = buildTeactConfig(features);

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

  let indexSrc = `import React from 'react';\n`;
  indexSrc += `import { Message } from '@teactjs/ui';\n`;
  indexSrc += `import { createBot, createRouter${has('i18n') ? ', createI18n' : ''} } from '@teactjs/core';\n`;
  indexSrc += `import type { Middleware } from '@teactjs/core';\n`;
  indexSrc += `import { TelegramAdapter } from '@teactjs/telegram';\n\n`;

  for (const r of routes) {
    indexSrc += `import { ${r.component} } from '${r.file}';\n`;
  }

  if (has('i18n')) {
    indexSrc += `\nimport en from './locales/en.json';\nimport am from './locales/am.json';\n`;
    indexSrc += `\nconst i18n = createI18n({\n  defaultLocale: 'en',\n  resources: {\n    en: { translation: en },\n    am: { translation: am },\n  },\n});\n`;
  }

  indexSrc += `\nconst loggerMiddleware: Middleware = async (ctx) => {\n  console.log(\`[middleware] \${ctx.chatId} | \${ctx.text ?? ctx.callbackData ?? '—'}\`);\n};\n`;

  indexSrc += `\nconst router = createRouter({\n`;
  for (const r of routes) {
    indexSrc += `  '${r.path}': ${r.component},\n`;
  }
  indexSrc += `}, { notFound: () => <Message text="Not found. Try /start." /> });\n`;

  indexSrc += `\nconst bot = createBot({\n  adapter: new TelegramAdapter(),\n  router,\n`;
  indexSrc += `  middleware: [loggerMiddleware],\n  experimental: {},\n`;
  if (has('i18n')) {
    indexSrc += `  providers: ({ children }) => (\n    <i18n.Provider>{children}</i18n.Provider>\n  ),\n`;
  }
  indexSrc += `  commands: {\n`;
  for (const [cmd, route] of Object.entries(commands)) {
    indexSrc += `    ${cmd}: { description: '${cmd.charAt(0).toUpperCase() + cmd.slice(1)}', route: ${route} },\n`;
  }
  indexSrc += `    help: {\n      description: 'Help',\n      handler: ({ reply }) =>\n        reply('Need help?', { buttons: [[{ text: 'Menu', route: '/' }]] }),\n    },\n`;
  indexSrc += `  },\n});\n\nbot.start();\n`;

  files['src/index.tsx'] = indexSrc;

  const menuButtons: string[] = [];
  menuButtons.push(`          <Button text="ℹ️ About" onClick={() => navigate('/about')} />`);
  if (has('storage')) menuButtons.push(`          <Button text="⚙️ Settings" onClick={() => navigate('/settings')} />`);
  if (has('streaming')) menuButtons.push(`          <Button text="⚡ Stream" onClick={() => navigate('/stream')} />`);
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

  if (has('storage')) {
    files['src/pages/Settings.tsx'] = asset('Settings.tsx');
  }
  if (has('streaming')) {
    files['src/pages/StreamDemo.tsx'] = asset('StreamDemo.tsx');
  }
  if (has('i18n')) {
    files['src/locales/en.json'] = asset('en.json');
    files['src/locales/am.json'] = asset('am.json');
    files['src/pages/LanguagePage.tsx'] = asset('LanguagePage.tsx');
  }
  if (has('payments')) {
    files['src/pages/StorePage.tsx'] = asset('StorePage.tsx');
  }

  return files;
}

function buildShowcaseCommands(features: string[]): string {
  const lines: string[] = [
    `import type { CommandDef } from '@teactjs/core';`,
    ``,
    `export const commands: Record<string, CommandDef> = {`,
    `  start: {`,
    `    description: 'Start the bot',`,
    `    route: '/',`,
    `    deepLink: (args) => {`,
    `      const param = args[0];`,
    `      if (param?.startsWith('comments-')) return \`/pokemon/\${param.slice(9)}/comments\`;`,
    `      if (param?.startsWith('poke-')) return \`/pokemon/\${param.slice(5)}\`;`,
    `      return '/';`,
    `    },`,
    `  },`,
    `  pokedex: { description: 'Open Pokedex', route: '/list' },`,
  ];
  if (hasFeature(features, 'streaming')) {
    lines.push(`  stream: { description: 'Stream demo', route: '/stream' },`);
  }
  lines.push(`  showcase: { description: 'Component showcase', route: '/showcase' },`);
  if (hasFeature(features, 'storage')) {
    lines.push(`  settings: { description: 'Bot settings', route: '/settings' },`);
  }
  if (hasFeature(features, 'i18n')) {
    lines.push(`  language: { description: 'Change language', route: '/language' },`);
  }
  if (hasFeature(features, 'payments')) {
    lines.push(`  store: { description: 'Premium store', route: '/store' },`);
  }
  if (hasFeature(features, 'auth')) {
    lines.push(`  secret: { description: 'Secret (redirect guard)', route: '/secret' },`);
  }
  lines.push(`  help: {`);
  lines.push(`    description: 'Show help',`);
  lines.push(`    handler: ({ reply }) =>`);
  lines.push(`      reply('What do you need help with?', {`);
  lines.push(`        buttons: [`);
  lines.push(`          [{ text: 'Pokedex', route: '/list' }, { text: 'Showcase', route: '/showcase' }],`);
  lines.push(`          [{ text: 'Support', url: 'https://t.me/telegram' }],`);
  lines.push(`        ],`);
  lines.push(`      }),`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push(``);
  return lines.join('\n');
}

function buildShowcaseMainMenu(features: string[]): string {
  const has = (f: string) => hasFeature(features, f);
  const rows: string[] = [];
  rows.push(`        <ButtonRow>`);
  rows.push(`          <Button text="📋 Pokedex" onClick={() => navigate('/list')} />`);
  rows.push(`          <Button text="🎲 Random" onClick={() => navigate(\`/pokemon/\${Math.floor(Math.random() * 151) + 1}\`)} />`);
  rows.push(`        </ButtonRow>`);
  if (has('streaming')) {
    rows.push(`        <ButtonRow>`);
    rows.push(`          <Button text="⚡ Stream" onClick={() => navigate('/stream')} />`);
    rows.push(`          <Button text="🧪 Showcase" onClick={() => navigate('/showcase')} />`);
    rows.push(`        </ButtonRow>`);
  } else {
    rows.push(`        <ButtonRow>`);
    rows.push(`          <Button text="🧪 Showcase" onClick={() => navigate('/showcase')} />`);
    rows.push(`        </ButtonRow>`);
  }
  const secondRow: string[] = [];
  if (has('storage')) secondRow.push(`<Button text="⚙️ Settings" onClick={() => navigate('/settings')} />`);
  if (has('i18n')) secondRow.push(`<Button text="🌐 Language" onClick={() => navigate('/language')} />`);
  if (has('payments')) secondRow.push(`<Button text="💎 Store" onClick={() => navigate('/store')} />`);
  if (secondRow.length) {
    rows.push(`        <ButtonRow>`);
    rows.push(`          ${secondRow.join('\n          ')}`);
    rows.push(`        </ButtonRow>`);
  }
  if (has('auth')) {
    rows.push(`        <ButtonRow>`);
    rows.push(`          <Button text="🔐 Secret (redirect)" onClick={() => navigate('/secret')} />`);
    rows.push(`          <Button text="🔑 Secret (JSX guard)" onClick={() => navigate('/secret-login')} />`);
    rows.push(`        </ButtonRow>`);
    rows.push(`        <ButtonRow>`);
    rows.push(`          <Button text="🔒 Secret (reply guard)" onClick={() => navigate('/secret-reply')} />`);
    rows.push(`          <Button text="🔓 Login" onClick={() => navigate('/login')} />`);
    rows.push(`        </ButtonRow>`);
  }
  rows.push(`        <ButtonRow>`);
  rows.push(`          <Button text="🏠 Home" onClick={() => navigate('/')} />`);
  rows.push(`        </ButtonRow>`);

  return `import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function MainMenu() {
  const navigate = useNavigate();

  return (
    <Message text="🤖 Teact Showcase\\n\\nExplore routes, deep links, and optional features:">
      <InlineKeyboard>
${rows.join('\n')}
      </InlineKeyboard>
    </Message>
  );
}
`;
}

function showcaseFiles(features: string[]): Record<string, string> {
  const has = (f: string) => hasFeature(features, f);
  const files: Record<string, string> = {};

  files['teact.config.ts'] = buildTeactConfig(features);
  files['src/commands.ts'] = buildShowcaseCommands(features);
  files['src/api/pokeapi.ts'] = asset('pokeapi.ts');
  files['src/hooks/usePokemon.ts'] = asset('usePokemon.ts');
  files['src/pages/MainMenu.tsx'] = buildShowcaseMainMenu(features);
  files['src/pages/PokemonList.tsx'] = asset('PokemonList.tsx');
  files['src/pages/PokemonCard.tsx'] = asset('PokemonCard.tsx');
  files['src/pages/PokemonComments.tsx'] = asset('PokemonComments.tsx');
  files['src/pages/NotFoundPage.tsx'] = asset('NotFoundPage.tsx');

  if (has('conversations')) {
    files['src/pages/ComponentShowcase.tsx'] = asset('ComponentShowcase.conversations.tsx');
  } else {
    files['src/pages/ComponentShowcase.tsx'] = asset('ComponentShowcase.lite.tsx');
  }

  if (has('streaming')) {
    files['src/pages/StreamDemo.tsx'] = asset('StreamDemo.tsx');
  }
  if (has('storage')) {
    files['src/pages/Settings.tsx'] = asset('Settings.tsx');
  }
  if (has('i18n')) {
    files['src/locales/en.json'] = asset('en.json');
    files['src/locales/am.json'] = asset('am.json');
    files['src/pages/LanguagePage.tsx'] = asset('LanguagePage.tsx');
  }
  if (has('payments')) {
    files['src/pages/StorePage.tsx'] = asset('StorePage.tsx');
  }
  if (has('auth')) {
    files['src/pages/LoginPage.tsx'] = asset('LoginPage.tsx');
    files['src/pages/SecretPage.tsx'] = asset('SecretPage.tsx');
    files['src/pages/SecretLoginPage.tsx'] = asset('SecretLoginPage.tsx');
  }

  files['src/index.tsx'] = buildShowcaseIndex(features);

  return files;
}

function buildShowcaseIndex(features: string[]): string {
  const has = (f: string) => hasFeature(features, f);

  const imports: string[] = [
    `import React from 'react';`,
    `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`,
    `import { createBot, createRouter, redirect${has('i18n') ? ', createI18n' : ''} } from '@teactjs/core';`,
    `import type { Middleware } from '@teactjs/core';`,
    `import { TelegramAdapter } from '@teactjs/telegram';`,
    `import { commands } from './commands';`,
    ``,
    `import { MainMenu } from './pages/MainMenu';`,
    `import { PokemonList } from './pages/PokemonList';`,
    `import { PokemonCard } from './pages/PokemonCard';`,
    `import { PokemonComments } from './pages/PokemonComments';`,
    `import { ComponentShowcase, ComponentGallery } from './pages/ComponentShowcase';`,
    `import { NotFoundPage } from './pages/NotFoundPage';`,
  ];

  if (has('streaming')) imports.push(`import { StreamDemo } from './pages/StreamDemo';`);
  if (has('storage')) imports.push(`import { Settings } from './pages/Settings';`);
  if (has('i18n')) {
    imports.push(`import en from './locales/en.json';`);
    imports.push(`import am from './locales/am.json';`);
  }
  if (has('payments')) imports.push(`import { StorePage } from './pages/StorePage';`);
  if (has('auth')) {
    imports.push(`import { LoginPage } from './pages/LoginPage';`);
    imports.push(`import { SecretPage } from './pages/SecretPage';`);
    imports.push(`import { SecretLoginPage } from './pages/SecretLoginPage';`);
  }

  const i18nBlock = has('i18n')
    ? `
const i18n = createI18n({
  defaultLocale: 'en',
  resources: {
    en: { translation: en },
    am: { translation: am },
  },
});
`
    : '';

  const routeLines: string[] = [
    `    '/': MainMenu,`,
    `    '/list': PokemonList,`,
    `    '/pokemon/:id': PokemonCard,`,
    `    '/pokemon/:id/comments': PokemonComments,`,
    `    '/showcase': ComponentShowcase,`,
    `    '/showcase/gallery': ComponentGallery,`,
  ];
  if (has('streaming')) routeLines.push(`    '/stream': StreamDemo,`);
  if (has('storage')) routeLines.push(`    '/settings': Settings,`);
  if (has('i18n')) routeLines.push(`    '/language': LanguagePage,`);
  if (has('payments')) routeLines.push(`    '/store': StorePage,`);
  if (has('auth')) {
    routeLines.push(`    '/secret': {`);
    routeLines.push(`      component: SecretPage,`);
    routeLines.push(`      beforeLoad: ({ session }) => {`);
    routeLines.push(`        if (!session.auth?.accessToken) return redirect('/');`);
    routeLines.push(`      },`);
    routeLines.push(`    },`);
    routeLines.push(`    '/secret-login': {`);
    routeLines.push(`      component: SecretLoginPage,`);
    routeLines.push(`      beforeLoad: ({ session }) => {`);
    routeLines.push(`        if (!session.auth?.accessToken) return <LoginPage />;`);
    routeLines.push(`      },`);
    routeLines.push(`    },`);
    routeLines.push(`    '/secret-reply': {`);
    routeLines.push(`      component: SecretLoginPage,`);
    routeLines.push(`      beforeLoad: ({ session, reply }) => {`);
    routeLines.push(`        if (!session.auth?.accessToken) return reply('🔒 You need to log in first.', {`);
    routeLines.push(`          buttons: [`);
    routeLines.push(`            [{ text: '🔑 Login', route: '/login' }, { text: '🏠 Menu', route: '/' }],`);
    routeLines.push(`          ],`);
    routeLines.push(`        });`);
    routeLines.push(`      },`);
    routeLines.push(`    },`);
    routeLines.push(`    '/login': LoginPage,`);
  }

  if (has('i18n')) {
    imports.push(`import { LanguagePage } from './pages/LanguagePage';`);
  }

  const providersInner = has('i18n')
    ? `<QueryClientProvider client={queryClient}>\n      <i18n.Provider>{children}</i18n.Provider>\n    </QueryClientProvider>`
    : `<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>`;

  return `${imports.join('\n')}
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});
${i18nBlock}
const loggerMiddleware: Middleware = async (ctx) => {
  console.log(\`[middleware] \${ctx.chatId} | \${ctx.text ?? ctx.callbackData ?? '—'}\`);
};

const router = createRouter(
  {
${routeLines.join('\n')}
  },
  { notFound: NotFoundPage },
);

const bot = createBot({
  adapter: new TelegramAdapter(),
  router,
  providers: ({ children }) => (
    ${providersInner}
  ),
  middleware: [loggerMiddleware],
  experimental: {},
  commands,
});

bot.start();
`;
}

/**
 * Legacy entry: `full` + empty features pre-selects every showcase plugin (matches old “full-stack” preset).
 * `showcase` + `[]` keeps an intentionally minimal showcase (advanced / non-interactive use).
 */
export function getTemplate(template: string, features: string[]): Record<string, string> {
  const tid = normalizeTemplate(template);
  const feats =
    template === 'full' && features.length === 0 ? [...SHOWCASE_DEFAULT_FEATURES] : [...features];
  return getTemplateFiles(tid, feats);
}

/** Merge shared + template-specific files (includes `.env` from `buildEnvContent`) */
export function getTemplateFiles(template: TemplateId, features: string[]): Record<string, string> {
  const files = { ...SHARED_FILES };

  let merged: Record<string, string>;
  switch (template) {
    case 'empty':
      merged = { ...files, ...emptyFiles() };
      break;
    case 'counter':
      merged = { ...files, ...counterFiles() };
      break;
    case 'starter':
      merged = { ...files, ...starterFiles(features) };
      break;
    case 'showcase':
      merged = { ...files, ...showcaseFiles(features) };
      break;
    default:
      merged = { ...files, ...starterFiles(features) };
  }
  merged['.env'] = buildEnvContent(features);
  return merged;
}
