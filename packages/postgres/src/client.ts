/** A result row: column name → value. */
export type Row = Record<string, unknown>;

/**
 * The normalised executor every client is adapted to: run a parameterised statement
 * (`$1`, `$2`, …) and resolve with its rows. Write your own for any other client.
 */
export type QueryFn = (text: string, values?: unknown[]) => Promise<Row[]>;

/** `pg` `Pool`/`Client`, `@neondatabase/serverless` `Pool`/`Client`, `@vercel/postgres` pools. */
export interface PgLikeClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  end?(): Promise<void> | void;
}

/** `@electric-sql/pglite` `PGlite` instance (`db.query(text, values) → { rows }`). */
export interface PgliteLikeClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  close?(): Promise<void>;
}

/** postgres.js `sql` instance — only `sql.unsafe(text, values)` is used. */
export interface PostgresJsLikeClient {
  (...args: any[]): any;
  unsafe(text: string, values?: any[]): PromiseLike<readonly Row[]> | Promise<Row[]>;
  end?(opts?: { timeout?: number }): Promise<void>;
}

/**
 * `neon()` HTTP function from `@neondatabase/serverless`. Current versions expose
 * `sql.query(text, values)`; older ones accept `sql(text, values)` directly.
 */
export interface NeonLikeClient {
  (...args: any[]): any;
  query?(text: string, values?: any[], opts?: any): Promise<Row[] | { rows: Row[] }>;
}

/** Anything {@link PostgresDriver} can auto-detect. */
export type PostgresClient = PgLikeClient | PgliteLikeClient | PostgresJsLikeClient | NeonLikeClient | QueryFn;

function rowsOf(res: unknown): Row[] {
  if (Array.isArray(res)) return res as Row[];
  if (res && Array.isArray((res as { rows?: unknown }).rows)) return (res as { rows: Row[] }).rows;
  return [];
}

/**
 * Adapt a `pg` `Pool` / `Client` (or anything pg-compatible: Neon `Pool`, Supabase's
 * pooler via `pg`, `@vercel/postgres`'s `db`, the pool behind Drizzle/Prisma's pg adapter).
 *
 * @example
 * import { Pool } from 'pg';
 * new PostgresDriver({ client: fromPg(new Pool({ connectionString })) });
 */
export function fromPg(client: PgLikeClient): QueryFn {
  return async (text, values) => rowsOf(await client.query(text, values));
}

/**
 * Adapt a postgres.js `sql` instance (`import postgres from 'postgres'`).
 *
 * @example
 * new PostgresDriver({ client: fromPostgresJs(postgres(process.env.DATABASE_URL!)) });
 */
export function fromPostgresJs(sql: PostgresJsLikeClient): QueryFn {
  return async (text, values) => rowsOf(await sql.unsafe(text, (values ?? []) as any[]));
}

/**
 * Adapt Neon's serverless HTTP driver (`neon(url)`) — works on edge runtimes. For Neon's
 * WebSocket `Pool`, use {@link fromPg}.
 *
 * @example
 * import { neon } from '@neondatabase/serverless';
 * new PostgresDriver({ client: fromNeon(neon(process.env.DATABASE_URL!)) });
 */
export function fromNeon(sql: NeonLikeClient): QueryFn {
  if (typeof sql.query === 'function') {
    return async (text, values) => rowsOf(await sql.query!(text, values ?? []));
  }
  return async (text, values) => rowsOf(await sql(text, values ?? []));
}

/**
 * Adapt an `@electric-sql/pglite` instance (Postgres in WASM — great for tests and local dev).
 *
 * @example
 * import { PGlite } from '@electric-sql/pglite';
 * new PostgresDriver({ client: fromPglite(new PGlite('./data/pg')) });
 */
export function fromPglite(db: PgliteLikeClient): QueryFn {
  return async (text, values) => rowsOf(await db.query(text, values));
}

/**
 * Detect the client kind and adapt it:
 * - function with `.unsafe` → postgres.js
 * - function with `.query`  → Neon HTTP
 * - object with `.query`    → pg / PGlite / Neon Pool (results with `.rows` or plain arrays)
 * - any other function      → already a {@link QueryFn}
 */
export function toQueryFn(client: PostgresClient): QueryFn {
  if (typeof client === 'function') {
    const fn = client as PostgresJsLikeClient & NeonLikeClient;
    if (typeof fn.unsafe === 'function') return fromPostgresJs(fn);
    if (typeof fn.query === 'function') return fromNeon(fn);
    return async (text, values) => rowsOf(await (client as QueryFn)(text, values));
  }
  if (client && typeof (client as PgLikeClient).query === 'function') {
    return fromPg(client as PgLikeClient);
  }
  throw new Error('[teact/postgres] Unsupported client: pass a pg Pool/Client, postgres.js sql, neon(), PGlite, or a (text, values) => rows function.');
}

/** Close a client using whichever method it has (`end` for pg/postgres.js, `close` for PGlite). */
export async function closeClient(client: PostgresClient): Promise<void> {
  const c = client as { end?: () => unknown; close?: () => unknown };
  if (typeof c.end === 'function') await c.end();
  else if (typeof c.close === 'function') await c.close();
}
