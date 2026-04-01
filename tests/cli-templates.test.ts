import { describe, test, expect } from 'bun:test';
import { getTemplate, getTemplateFiles, normalizeTemplate } from '@teactjs/bot-templates';

describe('getTemplate — shared files', () => {
  test('all templates include .env file', () => {
    for (const tmpl of ['counter', 'router', 'full', 'empty', 'starter', 'showcase']) {
      const files = getTemplate(tmpl, []);
      expect(files['.env']).toBeDefined();
      expect(files['.env']).toContain('TELEGRAM_BOT_TOKEN');
    }
  });

  test('all templates include .gitignore', () => {
    for (const tmpl of ['counter', 'router', 'full', 'empty']) {
      const files = getTemplate(tmpl, []);
      expect(files['.gitignore']).toBeDefined();
      expect(files['.gitignore']).toContain('node_modules');
      expect(files['.gitignore']).toContain('.env');
    }
  });

  test('all templates include tsconfig.json', () => {
    for (const tmpl of ['counter', 'router', 'full', 'empty']) {
      const files = getTemplate(tmpl, []);
      expect(files['tsconfig.json']).toBeDefined();
      expect(files['tsconfig.json']).toContain('"jsx"');
      expect(files['tsconfig.json']).toContain('react-jsx');
    }
  });

  test('all templates have src/index.tsx', () => {
    for (const tmpl of ['counter', 'router', 'full', 'empty']) {
      const files = getTemplate(tmpl, []);
      expect(files['src/index.tsx']).toBeDefined();
      expect(files['src/index.tsx'].length).toBeGreaterThan(0);
    }
  });
});

describe('getTemplate — counter template', () => {
  const files = getTemplate('counter', []);

  test('returns expected files', () => {
    expect(files['src/index.tsx']).toBeDefined();
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(4);
  });

  test('counter template uses useState', () => {
    expect(files['src/index.tsx']).toContain('useState');
  });

  test('counter template uses createBot', () => {
    expect(files['src/index.tsx']).toContain('createBot');
  });

  test('counter template has increment/decrement buttons', () => {
    expect(files['src/index.tsx']).toContain('+1');
    expect(files['src/index.tsx']).toContain('-1');
  });
});

describe('getTemplate — starter template (router)', () => {
  const files = getTemplate('router', []);

  test('returns expected files', () => {
    expect(files['src/index.tsx']).toBeDefined();
    expect(files['src/pages/MainMenu.tsx']).toBeDefined();
    expect(files['src/pages/About.tsx']).toBeDefined();
  });

  test('starter template uses createRouter', () => {
    expect(files['src/index.tsx']).toContain('createRouter');
  });

  test('starter template defines routes', () => {
    expect(files['src/index.tsx']).toContain("'/': MainMenu");
    expect(files['src/index.tsx']).toContain("'/about': About");
  });

  test('starter uses middleware and experimental', () => {
    expect(files['src/index.tsx']).toContain('middleware');
    expect(files['src/index.tsx']).toContain('experimental');
  });

  test('MainMenu uses useNavigate', () => {
    expect(files['src/pages/MainMenu.tsx']).toContain('useNavigate');
  });

  test('About has back navigation', () => {
    expect(files['src/pages/About.tsx']).toContain("navigate('/')");
  });
});

describe('getTemplate — starter template with features', () => {
  test('storage feature generates teact.config.ts and Settings page', () => {
    const files = getTemplate('router', ['storage']);
    expect(files['teact.config.ts']).toBeDefined();
    expect(files['teact.config.ts']).toContain('storagePlugin');
    expect(files['src/pages/Settings.tsx']).toBeDefined();
    expect(files['src/pages/Settings.tsx']).toContain('useStorage');
  });

  test('auth feature generates teact.config.ts with authPlugin', () => {
    const files = getTemplate('router', ['auth']);
    expect(files['teact.config.ts']).toBeDefined();
    expect(files['teact.config.ts']).toContain('authPlugin');
  });

  test('i18n feature generates locale files and LanguagePage', () => {
    const files = getTemplate('router', ['i18n']);
    expect(files['src/locales/en.json']).toBeDefined();
    expect(files['src/locales/am.json']).toBeDefined();
    expect(files['src/pages/LanguagePage.tsx']).toBeDefined();
    expect(files['src/pages/LanguagePage.tsx']).toContain('useLocale');
    expect(files['src/index.tsx']).toContain('createI18n');
  });

  test('payments feature generates StorePage with useInvoice', () => {
    const files = getTemplate('router', ['payments']);
    expect(files['src/pages/StorePage.tsx']).toBeDefined();
    expect(files['src/pages/StorePage.tsx']).toContain('useInvoice');
    expect(files['src/pages/StorePage.tsx']).toContain('providerToken');
    expect(files['.env']).toContain('PAYMENT_PROVIDER_TOKEN');
  });

  test('streaming feature generates StreamDemo page', () => {
    const files = getTemplate('router', ['streaming']);
    expect(files['src/pages/StreamDemo.tsx']).toBeDefined();
    expect(files['src/pages/StreamDemo.tsx']).toContain('useStream');
    expect(files['teact.config.ts']).toContain('streamPlugin');
  });

  test('conversations feature generates teact.config.ts with conversationsPlugin', () => {
    const files = getTemplate('router', ['conversations']);
    expect(files['teact.config.ts']).toBeDefined();
    expect(files['teact.config.ts']).toContain('conversationsPlugin');
  });

  test('multiple features generate all corresponding pages and config', () => {
    const files = getTemplate('router', ['storage', 'streaming', 'i18n', 'payments']);
    expect(files['teact.config.ts']).toContain('storagePlugin');
    expect(files['teact.config.ts']).toContain('streamPlugin');
    expect(files['src/pages/Settings.tsx']).toBeDefined();
    expect(files['src/pages/StreamDemo.tsx']).toBeDefined();
    expect(files['src/pages/LanguagePage.tsx']).toBeDefined();
    expect(files['src/pages/StorePage.tsx']).toBeDefined();
  });

  test('MainMenu includes buttons for selected features', () => {
    const files = getTemplate('router', ['storage', 'i18n']);
    expect(files['src/pages/MainMenu.tsx']).toContain("navigate('/settings')");
    expect(files['src/pages/MainMenu.tsx']).toContain("navigate('/language')");
  });
});

describe('getTemplate — full template (showcase + all plugins)', () => {
  const files = getTemplate('full', []);

  test('includes src/index.tsx with QueryClient and notFound', () => {
    expect(files['src/index.tsx']).toBeDefined();
    expect(files['src/index.tsx']).toContain('QueryClient');
    expect(files['src/index.tsx']).toContain('notFound: NotFoundPage');
  });

  test('includes commands with deepLink and help handler', () => {
    expect(files['src/commands.ts']).toBeDefined();
    expect(files['src/commands.ts']).toContain('deepLink');
    expect(files['src/commands.ts']).toContain('handler:');
  });

  test('includes teact.config.ts', () => {
    expect(files['teact.config.ts']).toBeDefined();
    expect(files['teact.config.ts']).toContain('defineConfig');
  });

  test('includes showcase pages', () => {
    expect(files['src/pages/MainMenu.tsx']).toBeDefined();
    expect(files['src/pages/PokemonList.tsx']).toBeDefined();
    expect(files['src/pages/ComponentShowcase.tsx']).toBeDefined();
    expect(files['src/pages/NotFoundPage.tsx']).toBeDefined();
  });

  test('includes auth guard routes when auth enabled', () => {
    expect(files['src/index.tsx']).toContain('/secret-login');
    expect(files['src/index.tsx']).toContain('beforeLoad');
  });

  test('full template has storagePlugin', () => {
    expect(files['teact.config.ts']).toContain('storagePlugin');
  });

  test('full template has conversationsPlugin', () => {
    expect(files['teact.config.ts']).toContain('conversationsPlugin');
  });

  test('full template has streamPlugin', () => {
    expect(files['teact.config.ts']).toContain('streamPlugin');
  });

  test('full template has authPlugin', () => {
    expect(files['teact.config.ts']).toContain('authPlugin');
  });

  test('Settings page uses useStorage', () => {
    expect(files['src/pages/Settings.tsx']).toContain('useStorage');
  });

  test('StreamDemo uses useStream', () => {
    expect(files['src/pages/StreamDemo.tsx']).toContain('useStream');
  });

  test('full template includes locale files', () => {
    expect(files['src/locales/en.json']).toBeDefined();
    expect(files['src/locales/am.json']).toBeDefined();
  });

  test('full template uses createI18n in index', () => {
    expect(files['src/index.tsx']).toContain('createI18n');
  });

  test('StorePage uses useInvoice with providerToken', () => {
    expect(files['src/pages/StorePage.tsx']).toContain('useInvoice');
    expect(files['src/pages/StorePage.tsx']).toContain('providerToken');
  });

  test('defineConversation in ComponentShowcase when conversations on', () => {
    expect(files['src/pages/ComponentShowcase.tsx']).toContain('defineConversation');
  });
});

describe('showcase without conversations uses lite ComponentShowcase', () => {
  const files = getTemplateFiles('showcase', ['storage', 'streaming', 'auth', 'i18n', 'payments']);

  test('no defineConversation import (lite template only mentions it in copy)', () => {
    expect(files['src/pages/ComponentShowcase.tsx']).not.toMatch(/from ['"]@teactjs\/telegram['"]/);
    expect(files['src/pages/ComponentShowcase.tsx']).not.toMatch(/defineConversation\s*\(/);
  });
});

describe('getTemplate — empty template', () => {
  const files = getTemplate('empty', []);

  test('returns minimal files', () => {
    const fileNames = Object.keys(files);
    expect(fileNames).toContain('src/index.tsx');
    expect(fileNames).toContain('.env');
    expect(fileNames).toContain('.gitignore');
    expect(fileNames).toContain('tsconfig.json');
  });

  test('empty template has no page files', () => {
    const pageFiles = Object.keys(files).filter((f) => f.includes('pages/'));
    expect(pageFiles).toHaveLength(0);
  });

  test('empty template uses createBot', () => {
    expect(files['src/index.tsx']).toContain('createBot');
  });

  test('empty template renders a Message', () => {
    expect(files['src/index.tsx']).toContain('Message');
    expect(files['src/index.tsx']).toContain('Hello from Teact!');
  });

  test('empty template has fewer files than full template', () => {
    const fullFiles = getTemplate('full', []);
    expect(Object.keys(files).length).toBeLessThan(Object.keys(fullFiles).length);
  });
});

describe('normalizeTemplate', () => {
  test('unknown template name falls back to starter', () => {
    expect(normalizeTemplate('nonexistent')).toBe('starter');
  });

  test('router maps to starter', () => {
    expect(normalizeTemplate('router')).toBe('starter');
  });

  test('full maps to showcase', () => {
    expect(normalizeTemplate('full')).toBe('showcase');
  });
});
