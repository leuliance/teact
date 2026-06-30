import React, { type FunctionComponent, type ReactNode } from 'react';
import type { Adapter, Middleware, TeactPlugin } from '@teactjs/core';

/**
 * The context handed to a plugin's `setup` function. Register everything the
 * plugin contributes here — middleware, React providers, DI services, and
 * lifecycle hooks.
 */
export interface PluginContext<C> {
  /** Resolved config (plugin `defaultConfig` merged with user-provided config). */
  config: C;
  /** Register update middleware (runs on every incoming update). */
  middleware(fn: Middleware): void;
  /** Wrap the app tree with a React provider. Multiple providers nest in order. */
  addProvider(provider: FunctionComponent<{ children: ReactNode }>): void;
  /** Register a service in the DI container — read it with `useService(key)`. */
  provideService(key: string, value: unknown): void;
  /** Run when the bot starts (after the adapter connects). */
  onStart(fn: (adapter: Adapter) => void | Promise<void>): void;
  /** Run when the bot stops. */
  onStop(fn: () => void | Promise<void>): void;
}

/** A plugin definition passed to {@link definePlugin}. */
export interface PluginDefinition<C> {
  name: string;
  /** Defaults merged under the user's config object. */
  defaultConfig?: C;
  setup: (ctx: PluginContext<C>) => void;
}

/** A configured plugin factory — call it (optionally with config) to get a plugin. */
export type PluginFactory<C> = (config?: C) => TeactPlugin;

/**
 * Author a Teact plugin. Returns a factory you call in `teact.config.ts`.
 *
 * @example
 * // my-supabase-plugin/index.ts
 * import { definePlugin } from '@teactjs/plugin-sdk';
 * import { createClient } from '@supabase/supabase-js';
 *
 * export const supabase = definePlugin<{ url: string; key: string }>({
 *   name: 'supabase',
 *   setup(ctx) {
 *     ctx.provideService('supabase', createClient(ctx.config.url, ctx.config.key));
 *   },
 * });
 *
 * // teact.config.ts
 * export default defineConfig({ plugins: [supabase({ url, key })] });
 *
 * // any component
 * const db = useService<SupabaseClient>('supabase');
 */
export function definePlugin<C = void>(def: PluginDefinition<C>): PluginFactory<C> {
  return (config?: C) => {
    const middlewares: Middleware[] = [];
    const providers: FunctionComponent<{ children: ReactNode }>[] = [];
    const services: Record<string, unknown> = {};
    const startHooks: Array<(a: Adapter) => void | Promise<void>> = [];
    const stopHooks: Array<() => void | Promise<void>> = [];

    const ctx: PluginContext<C> = {
      config: { ...(def.defaultConfig as object), ...(config as object) } as C,
      middleware: (fn) => { middlewares.push(fn); },
      addProvider: (p) => { providers.push(p); },
      provideService: (key, value) => { services[key] = value; },
      onStart: (fn) => { startHooks.push(fn); },
      onStop: (fn) => { stopHooks.push(fn); },
    };

    def.setup(ctx);

    const plugin: TeactPlugin = { name: def.name };
    if (Object.keys(services).length) plugin.services = services;
    if (middlewares.length) plugin.middleware = composeMiddleware(middlewares);
    if (providers.length) plugin.Provider = composeProviders(providers);
    if (startHooks.length) plugin.onStart = async (a) => { for (const h of startHooks) await h(a); };
    if (stopHooks.length) plugin.onStop = async () => { for (const h of stopHooks) await h(); };
    return plugin;
  };
}

function composeProviders(
  providers: FunctionComponent<{ children: ReactNode }>[],
): FunctionComponent<{ children: ReactNode }> {
  if (providers.length === 1) return providers[0];
  return ({ children }) =>
    providers.reduceRight<ReactNode>(
      (acc, P) => React.createElement(P, null, acc),
      children,
    ) as React.ReactElement;
}

function composeMiddleware(mws: Middleware[]): Middleware {
  return async (ctx, next) => {
    const run = async (idx: number): Promise<void> => {
      const fn = idx === mws.length ? next : mws[idx];
      if (fn) await fn(ctx, () => run(idx + 1));
    };
    await run(0);
  };
}
