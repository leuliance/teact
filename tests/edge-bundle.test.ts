import { describe, test, expect } from 'bun:test';

// Every package must bundle for edge/browser targets (Vercel Edge, Deno Deploy, Workers
// without nodejs_compat): no static imports of Node built-ins. Node-only features load
// them at runtime via process.getBuiltinModule.
describe('edge bundles', () => {
  for (const pkg of ['core', 'ui', 'telegram', 'storage', 'plugin-sdk']) {
    test(`@teactjs/${pkg} bundles for target "browser" without node: imports`, async () => {
      const result = await Bun.build({
        entrypoints: [`${import.meta.dir}/../packages/${pkg}/src/index.ts`],
        target: 'browser',
        external: ['react', 'react-reconciler', 'i18next', 'react-i18next', '@teactjs/*'],
      });
      expect(result.logs.filter((l) => l.level === 'error').map(String)).toEqual([]);
      expect(result.success).toBe(true);
      const code = (await Promise.all(result.outputs.map((o) => o.text()))).join('\n');
      expect(code.match(/from\s*["'](node:)?(fs|path|url|http|os|crypto)["']/g)).toBeNull();
    });
  }
});
