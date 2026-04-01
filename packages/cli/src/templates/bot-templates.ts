const SHARED_FILES: Record<string, string> = {
  '.env': `TELEGRAM_BOT_TOKEN=
`,
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

export function getTemplate(
  template: string,
  features: string[],
): Record<string, string> {
  const files = { ...SHARED_FILES };

  const has = (f: string) => template === 'full' || features.includes(f);
  if (has('payments')) files['.env'] += 'PAYMENT_PROVIDER_TOKEN=\n';

  switch (template) {
    case 'counter': return { ...files, ...counterTemplate(features) };
    case 'router': return { ...files, ...routerTemplate(features) };
    case 'full': return { ...files, ...fullTemplate() };
    case 'empty': return { ...files, ...emptyTemplate() };
    default: return { ...files, ...routerTemplate(features) };
  }
}

function counterTemplate(features: string[]): Record<string, string> {
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

function emptyTemplate(): Record<string, string> {
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

function routerTemplate(features: string[]): Record<string, string> {
  const has = (f: string) => features.includes(f);
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

  if (configPlugins.length > 0) {
    let configSrc = `import { ${configImportsCore.join(', ')} } from '@teactjs/core';\n`;
    if (configImportsTelegram.length > 0) {
      configSrc += `import { ${configImportsTelegram.join(', ')} } from '@teactjs/telegram';\n`;
    }
    if (configImportsStorage.length > 0) {
      configSrc += `import { ${configImportsStorage.join(', ')} } from '@teactjs/storage';\n`;
    }
    configSrc += `\nexport default defineConfig({\n  mode: 'polling',\n\n  plugins: [\n    ${configPlugins.join(',\n    ')},\n  ],\n});\n`;
    files['teact.config.ts'] = configSrc;
  }

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
  let indexSrc = '';
  if (has('i18n')) indexSrc += `import React from 'react';\n`;
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

function fullTemplate(): Record<string, string> {
  return routerTemplate(['storage', 'conversations', 'streaming', 'auth', 'i18n', 'payments']);
}
