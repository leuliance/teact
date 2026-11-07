import type { StorageDriver } from '../types';

/** A Cloudflare Workers KV namespace (structurally). */
interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list?(opts: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/** Generic async key-value operations (Redis, Upstash, Deno KV, a SQL table…). */
export interface KVStorageOptions {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  /** List keys with a prefix (needed only for keys()/clear()). */
  keys?(prefix: string): Promise<string[]>;
  /** Key prefix. @default 'teact:storage:' */
  prefix?: string;
}

/**
 * An async `StorageDriver` over any key-value store — values are stored as JSON.
 *
 * @example Redis (node-redis v4)
 * storagePlugin({ driver: kvStorageDriver({
 *   get: (k) => redis.get(k), set: (k, v) => redis.set(k, v), delete: (k) => redis.del(k),
 *   keys: (prefix) => redis.keys(`${prefix}*`),
 * }) })
 *
 * @example Cloudflare KV — bindings exist per request, so pass a getter
 * let env: Env;
 * storagePlugin({ driver: kvStorageDriver(() => env?.STORAGE) })
 */
export function kvStorageDriver(kv: KVStorageOptions): StorageDriver;
export function kvStorageDriver(kv: KVNamespaceLike | (() => KVNamespaceLike | undefined), opts?: { prefix?: string }): StorageDriver;
export function kvStorageDriver(
  kv: KVStorageOptions | KVNamespaceLike | (() => KVNamespaceLike | undefined),
  opts: { prefix?: string } = {},
): StorageDriver {
  const ns = (): KVNamespaceLike => {
    const v = typeof kv === 'function' ? kv() : (kv as KVNamespaceLike);
    if (!v) throw new Error('[teact/storage] kvStorageDriver: the KV namespace is not available yet (is the binding configured?)');
    return v;
  };
  const isNamespace = typeof kv === 'function' || typeof (kv as KVNamespaceLike).put === 'function';
  const o: KVStorageOptions = isNamespace
    ? {
        get: (k) => ns().get(k),
        set: (k, v) => ns().put(k, v),
        delete: (k) => ns().delete(k),
        keys: async (prefix) => {
          const n = ns();
          if (!n.list) throw new Error('[teact/storage] This KV namespace does not support list().');
          const names: string[] = [];
          let cursor: string | undefined;
          do {
            const page = await n.list({ prefix, cursor });
            names.push(...page.keys.map((k) => k.name));
            cursor = page.list_complete ? undefined : page.cursor;
          } while (cursor);
          return names;
        },
        ...opts,
      }
    : { ...(kv as KVStorageOptions), ...opts };
  const prefix = o.prefix ?? 'teact:storage:';
  const listKeys = async () => {
    if (!o.keys) throw new Error('[teact/storage] keys()/clear() need a `keys(prefix)` function on kvStorageDriver.');
    return (await o.keys(prefix)).map((k) => k.slice(prefix.length));
  };

  return {
    async get<T>(key: string) {
      const raw = await o.get(prefix + key);
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        console.warn(`[teact/storage] Corrupt JSON for "${key}" — treating it as missing.`);
        return undefined;
      }
    },
    async set<T>(key: string, value: T) {
      if (value === undefined) return void (await o.delete(prefix + key));
      let json: string;
      try {
        json = JSON.stringify(value);
      } catch (err) {
        throw new TypeError(`[teact/storage] Value for "${key}" can't be serialized to JSON: ${(err as Error).message}`);
      }
      await o.set(prefix + key, json);
    },
    async delete(key: string) {
      await o.delete(prefix + key);
    },
    async has(key: string) {
      return (await o.get(prefix + key)) != null;
    },
    async clear() {
      for (const k of await listKeys()) await o.delete(prefix + k);
    },
    async keys() {
      return listKeys();
    },
  };
}
