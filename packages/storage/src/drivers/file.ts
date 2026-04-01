import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StorageDriver } from '../types';

export class FileDriver implements StorageDriver {
  private data: Record<string, any> = {};
  private path: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  private load() {
    try {
      if (existsSync(this.path)) {
        this.data = JSON.parse(readFileSync(this.path, 'utf-8'));
      }
    } catch {
      this.data = {};
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.dirty = true;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, 100);
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (err) {
      console.error('[teact/storage] Failed to write:', err);
    }
  }

  get<T>(key: string): T | undefined {
    return this.data[key];
  }

  set<T>(key: string, value: T): void {
    this.data[key] = value;
    this.scheduleFlush();
  }

  delete(key: string): void {
    delete this.data[key];
    this.scheduleFlush();
  }

  has(key: string): boolean {
    return key in this.data;
  }

  clear(): void {
    this.data = {};
    this.scheduleFlush();
  }

  keys(): string[] {
    return Object.keys(this.data);
  }
}
