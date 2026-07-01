import { createContext, useContext } from 'react';

/** DI container: services contributed by plugins, keyed by name. */
export type ServiceMap = Record<string, unknown>;

export const ServicesCtx = createContext<ServiceMap>({});

/**
 * Read a service registered by a plugin (via `ctx.provideService` in `definePlugin`).
 *
 * @example
 * const db = useService<SupabaseClient>('supabase');
 * @throws if no service is registered under `key`.
 */
export function useService<T = unknown>(key: string): T {
  const services = useContext(ServicesCtx);
  if (!(key in services)) {
    throw new Error(
      `[teact] No service registered under "${key}". ` +
      `Register it in a plugin with ctx.provideService("${key}", value), ` +
      `and make sure that plugin is in your teact.config.ts plugins array.`,
    );
  }
  return services[key] as T;
}

/** Read a service if present, else `undefined` (non-throwing variant). */
export function useOptionalService<T = unknown>(key: string): T | undefined {
  return useContext(ServicesCtx)[key] as T | undefined;
}
