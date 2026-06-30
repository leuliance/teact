import { describe, test, expect } from 'bun:test';
import {
  TEACT_PEER_VERSION,
  normalizeTemplate,
  buildDependencies,
  buildEnvContent,
  getTemplateFiles,
} from '../packages/create-teact/lib/generate';

describe('scaffolder · dependencies', () => {
  const templates = ['empty', 'counter', 'starter', 'showcase'] as const;

  test('peer version is the 0.2.0-alpha line', () => {
    expect(TEACT_PEER_VERSION).toBe('^0.2.0-alpha.0');
  });

  for (const tpl of templates) {
    test(`${tpl}: deps reference only surviving packages at the peer version`, () => {
      const { dependencies } = buildDependencies(tpl, []);
      // core surface present
      expect(dependencies['@teactjs/core']).toBe(TEACT_PEER_VERSION);
      expect(dependencies['@teactjs/ui']).toBe(TEACT_PEER_VERSION);
      expect(dependencies['@teactjs/telegram']).toBe(TEACT_PEER_VERSION);
      expect(dependencies['@teactjs/cli']).toBe(TEACT_PEER_VERSION);
      // deleted packages must never be generated
      expect(dependencies['@teactjs/renderer']).toBeUndefined();
      expect(dependencies['@teactjs/react']).toBeUndefined();
      expect(dependencies['@teactjs/runtime']).toBeUndefined();
    });
  }

  test('storage feature adds @teactjs/storage', () => {
    const { dependencies } = buildDependencies('starter', ['storage']);
    expect(dependencies['@teactjs/storage']).toBe(TEACT_PEER_VERSION);
  });

  test('normalizeTemplate maps legacy values', () => {
    expect(normalizeTemplate('full')).toBe('showcase');
    expect(normalizeTemplate('router')).toBe('starter');
    expect(normalizeTemplate('counter')).toBe('counter');
    expect(normalizeTemplate('nonsense')).toBe('starter');
  });
});

describe('scaffolder · env', () => {
  test('always includes TELEGRAM_BOT_TOKEN', () => {
    expect(buildEnvContent([])).toContain('TELEGRAM_BOT_TOKEN=');
  });
  test('payments adds PAYMENT_PROVIDER_TOKEN', () => {
    expect(buildEnvContent(['payments'])).toContain('PAYMENT_PROVIDER_TOKEN=');
  });
});

describe('scaffolder · generated files', () => {
  test('every template produces a src entry + tsconfig + .env', () => {
    for (const tpl of ['empty', 'counter', 'starter', 'showcase'] as const) {
      const files = getTemplateFiles(tpl, tpl === 'showcase' ? ['storage', 'streaming'] : []);
      expect(files['src/index.tsx']).toBeTruthy();
      expect(files['tsconfig.json']).toBeTruthy();
      expect(files['.env']).toBeTruthy();
    }
  });

  test('starter generates router pages + teact.config', () => {
    const files = getTemplateFiles('starter', []);
    expect(files['src/pages/MainMenu.tsx']).toBeTruthy();
    expect(files['src/pages/About.tsx']).toBeTruthy();
    expect(files['teact.config.ts']).toBeTruthy();
  });

  test('generated source imports only surviving packages', () => {
    const files = getTemplateFiles('showcase', ['storage', 'streaming', 'auth', 'payments']);
    const all = Object.values(files).join('\n');
    expect(all).not.toContain('@teactjs/renderer');
    expect(all).not.toContain('@teactjs/runtime');
    expect(all).not.toContain("from '@teactjs/react'");
  });
});
