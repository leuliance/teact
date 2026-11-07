import type { StorageDriver } from '../types';

// Node built-ins are loaded at runtime, not imported statically, so @teactjs/storage (and its
// memory driver) still bundles for edge targets; the file driver simply has no fs there.
type Fs = typeof import('node:fs');
const nodeFs: Fs | undefined = (() => {
  try {
    return (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as Fs | undefined;
  } catch {
    return undefined;
  }
})();
const { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } = (nodeFs ?? {}) as Fs;
const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || '.';

/**
 * Whether this runtime has a writable filesystem. Cloudflare Workers / edge isolates
 * report a `Cloudflare-Workers` userAgent and have no usable fs — the file driver can't
 * work there, so we detect it and degrade to in-memory with a loud warning instead of
 * silently dropping every write.
 */
const HAS_FS = (() => {
  try {
    if (typeof navigator !== 'undefined' && (navigator as { userAgent?: string }).userAgent === 'Cloudflare-Workers') {
      return false;
    }
    return typeof nodeFs?.writeFileSync === 'function' && typeof nodeFs?.readFileSync === 'function';
  } catch {
    return false;
  }
})();

/**
 * JSON-file storage driver. Writes are synchronous and atomic (temp file + rename) so a
 * crash can't leave a half-written, corrupt store. Intended for local/dev and small
 * single-instance bots — for serverless or multi-instance, provide a custom async-backed
 * `StorageDriver` (KV, Redis, Postgres) instead.
 */
export class FileDriver implements StorageDriver {
  // A Map, not a plain object: keys like '__proto__' / 'constructor' must be ordinary keys.
  private data = new Map<string, any>();
  private path: string;
  private warnedNoFs = false;
  // Identity (mtime + size) of the file as we last read/wrote it. When it changes, another
  // process wrote the store, and we re-read before reading or writing — so processes
  // sharing a file merge per key instead of the last writer wiping everyone else's keys.
  private seen = '';
  // Set when a write failed; flush() (called on shutdown) retries only then.
  private dirty = false;

  constructor(path: string) {
    this.path = path;
    if (!HAS_FS) {
      console.warn(
        `[teact/storage] The file driver ("${path}") has no writable filesystem here ` +
        '(serverless/edge?). Data will be kept in memory only and lost between requests. ' +
        'Use a durable StorageDriver (KV/Redis/DB) for production: storagePlugin({ driver: myDriver }).',
      );
      return;
    }
    this.load();
  }

  private fileId(): string {
    try {
      const st = statSync(this.path);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  /** Re-read the store if another process changed it since we last looked. */
  private refresh(): void {
    if (!HAS_FS || this.dirty) return;
    const id = this.fileId();
    if (id !== this.seen) this.load();
  }

  private load() {
    this.seen = this.fileId();
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('expected a JSON object at the top level');
      }
      this.data = new Map(Object.entries(parsed));
    } catch (err) {
      // Never overwrite an unreadable store — the next write would destroy every chat's
      // data for good. Move it aside so it can be inspected/recovered, then start empty.
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try { renameSync(this.path, backup); } catch {}
      console.error(`[teact/storage] Could not read "${this.path}" — moved it to "${backup}" and started empty:`, err);
      this.data = new Map();
    }
  }

  /**
   * Retry a failed write. Every set/delete already persists synchronously, so this is a
   * no-op unless the last write failed — importantly, it never rewrites a stale snapshot
   * over data other processes have written since.
   */
  flush(): void {
    if (this.dirty) this.write();
  }

  /** Persist synchronously and atomically. No-op (with a one-time warning) when fs is absent. */
  private write(): void {
    if (!HAS_FS) {
      if (!this.warnedNoFs) {
        this.warnedNoFs = true;
        console.warn('[teact/storage] Ignoring persist — no filesystem available in this runtime.');
      }
      return;
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${(typeof process !== 'undefined' && process.pid) || 0}.tmp`;
      // Compact JSON: the whole store is rewritten per write, so size is speed.
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data)));
      renameSync(tmp, this.path); // atomic on the same filesystem
      this.seen = this.fileId();
      this.dirty = false;
    } catch (err) {
      this.dirty = true;
      console.error('[teact/storage] Failed to write:', err);
    }
  }

  get<T>(key: string): T | undefined {
    this.refresh();
    return this.data.get(key);
  }

  set<T>(key: string, value: T): void {
    if (value === undefined) return this.delete(key);
    // Validate BEFORE touching the store: an unserializable value (BigInt, circular, …)
    // kept in memory would make every later write fail. Store the JSON form, so what you
    // read back now is exactly what survives a restart (e.g. a Date becomes a string).
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch (err) {
      throw new TypeError(`[teact/storage] Value for "${key}" can't be serialized to JSON: ${(err as Error).message}`);
    }
    if (json === undefined) {
      throw new TypeError(`[teact/storage] Value for "${key}" can't be serialized to JSON (got ${typeof value}).`);
    }
    this.refresh();
    this.data.set(key, JSON.parse(json));
    this.write();
  }

  delete(key: string): void {
    this.refresh();
    if (this.data.delete(key)) this.write();
  }

  has(key: string): boolean {
    this.refresh();
    return this.data.has(key);
  }

  clear(): void {
    this.data.clear();
    this.write();
  }

  keys(): string[] {
    this.refresh();
    return [...this.data.keys()];
  }
}
