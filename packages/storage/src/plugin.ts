import React, { useCallback, useContext, useMemo, useRef, useSyncExternalStore, createContext } from 'react';
import type { TeactPlugin } from '@teactjs/core';
import { useBot, WorkTrackerCtx } from '@teactjs/core';
import type { StorageDriver, StoragePluginOptions } from './types';
import { MemoryDriver } from './drivers/memory';
import { FileDriver } from './drivers/file';

const StorageCtx = createContext<StorageDriver | null>(null);

function useDriver(): StorageDriver {
  const ctx = useContext(StorageCtx);
  if (!ctx) throw new Error('useStorage requires the storagePlugin to be registered');
  return ctx;
}

// Per-driver, per-key listeners so every component (in every chat root / forum topic)
// reading a key re-renders when any of them writes it.
const listeners = new WeakMap<StorageDriver, Map<string, Set<() => void>>>();

function subscribe(driver: StorageDriver, key: string, fn: () => void): () => void {
  let byKey = listeners.get(driver);
  if (!byKey) listeners.set(driver, (byKey = new Map()));
  let set = byKey.get(key);
  if (!set) byKey.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) byKey!.delete(key);
  };
}

function notify(driver: StorageDriver, key: string): void {
  for (const fn of [...(listeners.get(driver)?.get(key) ?? [])]) fn();
}

const isPromise = (v: unknown): v is Promise<unknown> => !!v && typeof (v as Promise<unknown>).then === 'function';

// Values of async drivers, cached per key so renders stay synchronous: `loading` until the
// first read resolves; writes update the cache immediately (optimistic) and persist after.
type Entry = { value: unknown; loaded: boolean; loading?: Promise<void>; at: number };
/** Cached async values are revalidated in the background after this long (other instances may write). */
const REVALIDATE_MS = 1_000;
// Per-driver, per-key write queues: writes to one key within an instance never race.
const writeQueues = new WeakMap<StorageDriver, Map<string, Promise<unknown>>>();
const asyncCache = new WeakMap<StorageDriver, Map<string, Entry>>();
const cacheOf = (driver: StorageDriver) => {
  let m = asyncCache.get(driver);
  if (!m) asyncCache.set(driver, (m = new Map()));
  return m;
};

export interface UseStorageOptions {
  /**
   * Who the value belongs to. `'chat'` (default): shared by everyone in the chat.
   * `'user'`: per user (also inside groups). `'global'`: one value for the whole bot.
   */
  scope?: 'chat' | 'user' | 'global';
}

/** Extra state returned as the third tuple element of {@link useStorage}. */
export interface StorageStatus {
  /** True while an async driver is still loading the value (the default is shown meanwhile). */
  loading: boolean;
}

/**
 * Like useState but persisted across bot restarts.
 *
 * The driver is the single source of truth: every component reading the same key sees the
 * latest value, and updater functions always receive the freshest stored value (no lost
 * updates). Works with sync drivers (memory, file) and async ones (Redis, KV, databases —
 * the default value shows while loading; `loading` tells you which).
 *
 * @example
 * const [favorites, setFavorites] = useStorage<number[]>('favorites', []);
 * setFavorites(prev => [...prev, pokemonId]);
 *
 * const [theme, setTheme, { loading }] = useStorage('theme', 'light', { scope: 'user' });
 */
export function useStorage<T>(
  key: string,
  defaultValue: T,
  options: UseStorageOptions = {},
): [T, (value: T | ((prev: T) => T)) => void, StorageStatus] {
  const driver = useDriver();
  const bot = useBot();
  const tracker = useContext(WorkTrackerCtx);
  const scope = options.scope ?? 'chat';
  const scopedKey =
    scope === 'global' ? `global:${key}`
    : scope === 'user' ? `${bot.platform}:user:${bot.userId}:${key}`
    : `${bot.platform}:${bot.chatId}:${key}`;
  // Stable default: an inline `[]` is a new array every render, which must not look like a change.
  const defaultRef = useRef(defaultValue);

  const read = useCallback((): { value: T; loading: boolean } => {
    const cached = asyncCache.get(driver)?.get(scopedKey);
    if (cached?.loaded && !cached.loading && Date.now() - cached.at > REVALIDATE_MS) {
      // Stale-while-revalidate: keep showing the cached value, refresh in the background.
      const p = driver.get<T>(scopedKey);
      if (isPromise(p)) {
        cached.loading = p.then(
          (v) => { cached.value = v; cached.at = Date.now(); },
          () => { cached.at = Date.now(); },
        ).finally(() => { cached.loading = undefined; notify(driver, scopedKey); });
        tracker?.track(cached.loading);
      }
    }
    if (cached) return { value: cached.loaded && cached.value !== undefined ? (cached.value as T) : defaultRef.current, loading: !cached.loaded };
    const result = driver.get<T>(scopedKey);
    if (!isPromise(result)) return { value: result === undefined ? defaultRef.current : (result as T), loading: false };
    // Async driver: cache the pending read and re-render everyone once it resolves.
    const entry: Entry = { value: undefined, loaded: false, at: Date.now() };
    entry.loading = result.then(
      (v) => { entry.value = v; entry.loaded = true; entry.at = Date.now(); },
      (err) => { entry.loaded = true; entry.at = Date.now(); console.error(`[teact/storage] Failed to read "${scopedKey}":`, err); },
    ).finally(() => { entry.loading = undefined; notify(driver, scopedKey); });
    tracker?.track(entry.loading);
    cacheOf(driver).set(scopedKey, entry);
    return { value: defaultRef.current, loading: true };
  }, [driver, scopedKey, tracker]);

  // useSyncExternalStore needs a stable snapshot: cache the last {value, loading} pair.
  const snapRef = useRef<{ value: T; loading: boolean } | null>(null);
  const getSnapshot = useCallback(() => {
    const next = read();
    const prev = snapRef.current;
    if (prev && Object.is(prev.value, next.value) && prev.loading === next.loading) return prev;
    return (snapRef.current = next);
  }, [read]);
  const snapshot = useSyncExternalStore(
    useCallback((fn: () => void) => subscribe(driver, scopedKey, fn), [driver, scopedKey]),
    getSnapshot,
    getSnapshot,
  );

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    const update = typeof next === 'function' ? (next as (p: T) => T) : () => next;
    if (!asyncCache.get(driver)?.has(scopedKey)) {
      // Sync driver: the store is the source of truth — apply and write directly.
      driver.set(scopedKey, update(read().value));
      notify(driver, scopedKey);
      return;
    }
    // Async driver. Show the result now (optimistic, from the cache)…
    const cache = cacheOf(driver);
    cache.set(scopedKey, { value: update(read().value), loaded: true, at: Date.now() });
    notify(driver, scopedKey);
    // …but persist the updater applied to the FRESHEST stored value: another instance
    // (serverless isolate, server) may have written since we cached — applying `n => n + 1`
    // to a stale 1 would overwrite a newer 3. Writes per key are queued within an instance.
    let queues = writeQueues.get(driver);
    if (!queues) writeQueues.set(driver, (queues = new Map()));
    const prev = queues.get(scopedKey) ?? Promise.resolve();
    const job: Promise<void> = prev.then(async () => {
      const stored = await driver.get<T>(scopedKey);
      const value = update(stored === undefined ? defaultRef.current : (stored as T));
      await driver.set(scopedKey, value);
      // Only the last queued write updates what's shown — earlier ones would briefly roll
      // the optimistic value back.
      if (queues!.get(scopedKey) === job) {
        cache.set(scopedKey, { value, loaded: true, at: Date.now() });
        notify(driver, scopedKey);
      }
    }).catch((err) => console.error(`[teact/storage] Failed to save "${scopedKey}":`, err));
    queues.set(scopedKey, job);
    job.finally(() => { if (queues!.get(scopedKey) === job) queues!.delete(scopedKey); });
    tracker?.track(job);
  }, [driver, scopedKey, read, tracker]);

  const status = useMemo(() => ({ loading: snapshot.loading }), [snapshot.loading]);
  return [snapshot.value, setAndPersist, status];
}

/**
 * Access the raw storage driver (not scoped to a chat).
 * Useful for global data shared across all chats.
 */
export function useGlobalStorage(): StorageDriver {
  return useDriver();
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
  let driver: StorageDriver;
  if (typeof opts.driver === 'object') {
    driver = opts.driver;
  } else if (opts.driver === 'file') {
    driver = new FileDriver(opts.path ?? '.teact/storage.json');
  } else {
    driver = new MemoryDriver();
  }

  return {
    name: 'teact-storage',

    Provider: ({ children }) =>
      React.createElement(StorageCtx.Provider, { value: driver }, children),

    onStop: () => {
      if ('flush' in driver && typeof (driver as any).flush === 'function') {
        (driver as any).flush();
      }
    },
  };
}
