import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StorageDriver } from '../types';

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
    return typeof writeFileSync === 'function' && typeof readFileSync === 'function';
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
  private data: Record<string, any> = {};
  private path: string;
  private warnedNoFs = false;

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

  private load() {
    try {
      if (existsSync(this.path)) {
        this.data = JSON.parse(readFileSync(this.path, 'utf-8'));
      }
    } catch (err) {
      // A corrupt/truncated file would otherwise silently reset the store — surface it.
      console.error(`[teact/storage] Could not read "${this.path}" (starting empty):`, err);
      this.data = {};
    }
  }

  /** Persist synchronously and atomically. No-op (with a one-time warning) when fs is absent. */
  flush(): void {
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
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.path); // atomic on the same filesystem
    } catch (err) {
      console.error('[teact/storage] Failed to write:', err);
    }
  }

  get<T>(key: string): T | undefined {
    return this.data[key];
  }

  set<T>(key: string, value: T): void {
    this.data[key] = value;
    this.flush();
  }

  delete(key: string): void {
    delete this.data[key];
    this.flush();
  }

  has(key: string): boolean {
    return key in this.data;
  }

  clear(): void {
    this.data = {};
    this.flush();
  }

  keys(): string[] {
    return Object.keys(this.data);
  }
}
