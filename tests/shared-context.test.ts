import { describe, test, expect } from 'bun:test';
import { sharedContext } from '../packages/core/src/renderer/shared-context';
import { CallbackRegistryCtx } from '../packages/core/src/renderer';
import { RuntimeContext } from '../packages/core/src/runtime/context';

describe('sharedContext', () => {
  test('a second copy of core gets the very same context objects', () => {
    // A duplicated @teactjs/core would call sharedContext again with the same names.
    expect(sharedContext<unknown>('callback-registry', null) as unknown).toBe(CallbackRegistryCtx);
    expect(sharedContext<unknown>('runtime', null) as unknown).toBe(RuntimeContext);
  });
  test('different names stay distinct', () => {
    expect(sharedContext('a-test', 1)).not.toBe(sharedContext('b-test', 1));
  });
});
