import type { AsyncStorageDriver, SetOptions } from './types';

/**
 * In-memory {@link AsyncStorageDriver}. Handy in tests and as a reference implementation
 * for driver authors (it honours `ttl`).
 */
export class MemoryAsyncDriver implements AsyncStorageDriver {
  readonly async = true as const;
  private store = new Map<string, { value: unknown; expiresAt?: number }>();

  private live(key: string) {
    const e = this.store.get(key);
    if (e?.expiresAt !== undefined && Date.now() >= e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.live(key)?.value) as T | undefined;
  }
  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    this.store.set(key, {
      value: structuredClone(value),
      expiresAt: opts?.ttl ? Date.now() + opts.ttl : undefined,
    });
  }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async has(key: string): Promise<boolean> { return !!this.live(key); }
  async keys(prefix = ''): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix) && this.live(k));
  }
  async clear(prefix = ''): Promise<void> {
    for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
  }
  async entries(prefix: string): Promise<Array<[string, unknown]>> {
    const keys = await this.keys(prefix);
    return Promise.all(keys.map(async (k) => [k, await this.get(k)] as [string, unknown]));
  }
}

/** Test-runner functions, passed in so this module never imports `bun:test` itself. */
export interface DriverConformanceOptions {
  describe: (name: string, fn: () => void) => void;
  test: (name: string, fn: () => any) => void;
  expect: (value: unknown) => any;
  /** Skip the TTL test for backends that can't expire keys in-process quickly. */
  skipTtl?: boolean;
}

/**
 * Shared behaviour tests every {@link AsyncStorageDriver} must pass. Database packages
 * call this from their test file with a factory that returns a fresh, empty driver.
 *
 * @example
 * import { describe, test, expect } from 'bun:test';
 * runDriverConformance('RedisDriver', () => new RedisDriver({ client: fakeRedis() }), { describe, test, expect });
 */
export function runDriverConformance(
  name: string,
  make: () => AsyncStorageDriver | Promise<AsyncStorageDriver>,
  { describe, test, expect, skipTtl }: DriverConformanceOptions,
): void {
  describe(`${name} · AsyncStorageDriver conformance`, () => {
    test('is marked async', async () => {
      expect((await make()).async).toBe(true);
    });

    test('get on a missing key resolves undefined', async () => {
      const d = await make();
      expect(await d.get('nope')).toBeUndefined();
      expect(await d.has('nope')).toBe(false);
    });

    test('round-trips JSON values', async () => {
      const d = await make();
      const values: unknown[] = ['text', 42, 0, true, false, null, [1, 'two'], { a: { b: [1, 2] } }];
      for (const [i, v] of values.entries()) {
        await d.set(`k${i}`, v);
        expect(await d.get(`k${i}`)).toEqual(v);
        expect(await d.has(`k${i}`)).toBe(true);
      }
    });

    test('set overwrites and delete removes', async () => {
      const d = await make();
      await d.set('x', 1);
      await d.set('x', 2);
      expect(await d.get('x')).toBe(2);
      await d.delete('x');
      expect(await d.get('x')).toBeUndefined();
      await d.delete('x'); // deleting a missing key is a no-op
    });

    test('keys and entries filter by prefix', async () => {
      const d = await make();
      await d.set('telegram:1:a', 'A');
      await d.set('telegram:1:b', 'B');
      await d.set('telegram:2:a', 'other chat');
      await d.set('telegram:1_x', 'not this prefix');
      expect((await d.keys('telegram:1:')).sort()).toEqual(['telegram:1:a', 'telegram:1:b']);
      expect((await d.keys()).length).toBe(4);
      if (d.entries) {
        const entries = (await d.entries('telegram:1:')).sort(([a], [b]) => a.localeCompare(b));
        expect(entries).toEqual([['telegram:1:a', 'A'], ['telegram:1:b', 'B']]);
      }
    });

    test('prefixes with LIKE/glob metacharacters are matched literally', async () => {
      const d = await make();
      await d.set('a%_*?[b]:1', 1);
      await d.set('aXYZb]:1', 2);
      expect(await d.keys('a%_*?[b]:')).toEqual(['a%_*?[b]:1']);
    });

    test('clear(prefix) only removes matching keys; clear() removes all', async () => {
      const d = await make();
      await d.set('p:1', 1);
      await d.set('p:2', 2);
      await d.set('q:1', 3);
      await d.clear('p:');
      expect(await d.keys()).toEqual(['q:1']);
      await d.clear();
      expect(await d.keys()).toEqual([]);
    });

    if (!skipTtl) {
      test('ttl expires entries', async () => {
        const d = await make();
        await d.set('short', 'v', { ttl: 30 });
        await d.set('long', 'v');
        expect(await d.get('short')).toBe('v');
        await new Promise((r) => setTimeout(r, 60));
        expect(await d.get('short')).toBeUndefined();
        expect(await d.get('long')).toBe('v');
      });
    }
  });
}
