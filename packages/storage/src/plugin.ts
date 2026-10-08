import React, { useState, useCallback, useContext, createContext } from 'react';
import type { TeactPlugin } from '@teactjs/core';
import { useChatId, usePlatform, RuntimeContext } from '@teactjs/core';
import type { AnyStorageDriver, StorageDriver, StoragePluginOptions } from './types';
import { MemoryDriver } from './drivers/memory';
import { FileDriver } from './drivers/file';
import { CachedDriver, isAsyncDriver } from './drivers/cached';

const StorageCtx = createContext<StorageDriver | null>(null);
const BackendCtx = createContext<AnyStorageDriver | null>(null);

function useDriver(): StorageDriver {
  const ctx = useContext(StorageCtx);
  if (!ctx) throw new Error('useStorage requires the storagePlugin to be registered');
  return ctx;
}

/**
 * Like useState but persisted across bot restarts.
 * Keys are auto-scoped to the current chat.
 *
 * @example
 * const [favorites, setFavorites] = useStorage<number[]>('favorites', []);
 * setFavorites(prev => [...prev, pokemonId]);
 */
export function useStorage<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const driver = useDriver();
  const chatId = useChatId();
  const platform = usePlatform();
  const scopedKey = `${platform}:${chatId}:${key}`;

  // Read through the driver on every render (not a useState snapshot): with an async
  // backend the cache is re-hydrated before each update, so a value written by another
  // instance or another handler shows up on the next render of an already-mounted screen.
  const [, bump] = useState(0);
  const stored = driver.get<T>(scopedKey);
  const value = stored !== undefined ? stored : defaultValue;

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    const current = driver.get<T>(scopedKey);
    const prev = current !== undefined ? current : defaultValue;
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
    driver.set(scopedKey, resolved);
    bump((n) => n + 1);
    // defaultValue is intentionally read at call time; callers often pass inline literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedKey, driver]);

  return [value, setAndPersist];
}

/**
 * Access the raw storage driver (not scoped to a chat).
 * Useful for global data shared across all chats.
 *
 * With an async driver this is a synchronous view over the cache: it only sees the
 * current chat's keys and the prefixes listed in `storagePlugin({ preload })`. Use
 * {@link useStorageBackend} to query anything else.
 */
export function useGlobalStorage(): StorageDriver {
  return useDriver();
}

/**
 * The driver exactly as passed to `storagePlugin` — sync or async. Use it for queries
 * outside the per-update cache, e.g. `await backend.keys('leaderboard:')` inside `useQuery`.
 */
export function useStorageBackend(): AnyStorageDriver {
  const ctx = useContext(BackendCtx);
  if (!ctx) throw new Error('useStorageBackend requires the storagePlugin to be registered');
  return ctx;
}

/**
 * Create the storage plugin.
 *
 * @example
 * import { storagePlugin } from '@teactjs/storage';
 *
 * createBot({
 *   plugins: [storagePlugin({ driver: 'file', path: './data/storage.json' })],
 *   // ...
 * });
 */
export function storagePlugin(opts: StoragePluginOptions = {}): TeactPlugin {
  let backend: AnyStorageDriver;
  if (typeof opts.driver === 'object') {
    backend = opts.driver;
  } else if (opts.driver === 'file') {
    backend = new FileDriver(opts.path ?? '.teact/storage.json');
  } else {
    backend = new MemoryDriver();
  }

  if (!isAsyncDriver(backend)) {
    const sync = backend;
    const Provider = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        BackendCtx.Provider,
        { value: backend },
        React.createElement(StorageCtx.Provider, { value: sync }, children),
      );
    return {
      name: 'teact-storage',
      Provider,
      onStop: () => {
        if ('flush' in sync && typeof (sync as any).flush === 'function') {
          (sync as any).flush();
        }
      },
    };
  }

  // Async backend. Every update gets its own CachedDriver holding only that chat's keys
  // (plus `preload` prefixes): loaded before rendering, flushed after. Caches are never
  // shared between chats, so one chat can't see, clear or inherit errors from another.
  //
  // Components see a per-chat view whose target is swapped to the current update's cache.
  // The view is stable across updates, so a setter captured by an earlier render (an
  // onClick handler runs at the start of the *next* update) writes into the update that
  // is actually running and is flushed with it.
  const async = backend;
  const preload = opts.preload ?? [];
  const views = new Map<string, ChatStorageView>();
  const viewFor = (chatKey: string) => {
    let view = views.get(chatKey);
    if (!view) views.set(chatKey, (view = new ChatStorageView(new CachedDriver(async))));
    return view;
  };

  const AsyncProvider = ({ children }: { children: React.ReactNode }) => {
    const rt = useContext(RuntimeContext);
    const chatKey = rt ? `${rt.botCtx.platform}:${rt.botCtx.chatId}` : '';
    return React.createElement(
      BackendCtx.Provider,
      { value: backend },
      React.createElement(StorageCtx.Provider, { value: viewFor(chatKey) }, children),
    );
  };

  return {
    name: 'teact-storage',
    Provider: AsyncProvider,
    middleware: async (ctx, next) => {
      const cache = new CachedDriver(async);
      await Promise.all([
        cache.hydrate(`${ctx.platform}:${ctx.chatId}:`),
        ...preload.map((prefix) => cache.hydrate(prefix)),
      ]);
      viewFor(`${ctx.platform}:${ctx.chatId}`).current = cache;
      try {
        await next();
      } finally {
        await cache.flush();
      }
    },
    onStop: async () => {
      const results = await Promise.allSettled([...views.values()].map((v) => v.current.flush()));
      for (const r of results) {
        if (r.status === 'rejected') console.error('[teact/storage] Failed to flush on stop:', r.reason);
      }
      views.clear();
      await async.close?.();
    },
  };
}

/** A chat's storage as seen by components: forwards to the current update's cache. */
class ChatStorageView implements StorageDriver {
  constructor(public current: CachedDriver) {}
  get<T>(key: string): T | undefined { return this.current.get<T>(key); }
  set<T>(key: string, value: T): void { this.current.set(key, value); }
  delete(key: string): void { this.current.delete(key); }
  has(key: string): boolean { return this.current.has(key); }
  clear(): void { this.current.clear(); }
  keys(): string[] { return this.current.keys(); }
}
