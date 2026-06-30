import React, { useState, useCallback, useContext, createContext } from 'react';
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

  const [value, setValue] = useState<T>(() => {
    const stored = driver.get<T>(scopedKey);
    return stored !== undefined ? stored : defaultValue;
  });

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      driver.set(scopedKey, resolved);
      return resolved;
    });
  }, [scopedKey, driver]);

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
