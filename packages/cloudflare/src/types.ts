// Structural shapes of the Cloudflare Workers bindings Teact uses. Real `KVNamespace` /
// `D1Database` objects (from `@cloudflare/workers-types` or `wrangler types`) are
// assignable to them, and nothing has to be installed to compile.

/** One page of `KVNamespace.list()`. */
export interface KVListResultLike {
  keys: Array<{ name: string; expiration?: number }>;
  list_complete: boolean;
  cursor?: string;
}

/** The subset of a Workers KV binding (`KVNamespace`) Teact uses. */
export interface KVNamespaceLike {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string | null; cursor?: string | null; limit?: number }): Promise<KVListResultLike>;
}

/** The subset of a D1 prepared statement Teact uses. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/** The subset of a D1 binding (`D1Database`) Teact uses. */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

/**
 * A binding, or a function returning it. Workers hand you bindings on `env`. A getter
 * lets you build the driver at module scope and resolve the binding lazily on first use,
 * for example `() => env.KV` with `import { env } from 'cloudflare:workers'`.
 */
export type Lazy<T> = T | (() => T);

/**
 * Normalize `SetOptions.ttl`: a positive finite number of ms, or `undefined` for "never
 * expires" (`0`, negative, `NaN`, `Infinity` or omitted). Internal.
 */
export function normalizeTtl(ttl: number | undefined): number | undefined {
  return typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : undefined;
}

/** Resolve a {@link Lazy} binding. */
export function resolve<T extends object>(b: Lazy<T>): T {
  return typeof b === 'function' ? (b as () => T)() : b;
}
