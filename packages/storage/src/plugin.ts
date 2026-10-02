import React, { useCallback, useContext, useRef, useSyncExternalStore, createContext } from 'react';
import type { TeactPlugin } from '@teactjs/core';
import { useChatId, usePlatform } from '@teactjs/core';
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

/**
 * Like useState but persisted across bot restarts.
 * Keys are auto-scoped to the current chat. The driver is the single source of truth:
 * every component reading the same key sees the latest value, and updater functions
 * always receive the freshest stored value (no lost updates).
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
  // Stable default: an inline `[]` is a new array every render, which must not look like a change.
  const defaultRef = useRef(defaultValue);

  const read = useCallback(
    (): T => (driver.has(scopedKey) ? (driver.get<T>(scopedKey) as T) : defaultRef.current),
    [driver, scopedKey],
  );
  const value = useSyncExternalStore(
    useCallback((fn: () => void) => subscribe(driver, scopedKey, fn), [driver, scopedKey]),
    read,
    read,
  );

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(read()) : next;
    driver.set(scopedKey, resolved);
    notify(driver, scopedKey);
  }, [driver, scopedKey, read]);

  return [value, setAndPersist];
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
