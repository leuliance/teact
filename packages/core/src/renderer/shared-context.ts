import React from 'react';

/**
 * Create a React context that is a process-wide singleton.
 *
 * Teact's packages share contexts (e.g. @teactjs/ui's <Button> registers click handlers in
 * core's CallbackRegistryCtx). If a project ends up with two copies of @teactjs/core —
 * mismatched versions, pnpm/yarn hoisting, a bundler resolving src in one place and dist
 * in another — each copy would create its own context object and the packages would stop
 * seeing each other: buttons silently do nothing, hooks throw "must be used inside…".
 * Keying the context on a global symbol makes every copy use the same object.
 */
export function sharedContext<T>(name: string, defaultValue: T): React.Context<T> {
  const key = Symbol.for(`teact.context.${name}`);
  const g = globalThis as Record<symbol, React.Context<T> | undefined>;
  return (g[key] ??= React.createContext<T>(defaultValue));
}
