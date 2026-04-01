import type { StorageDriver } from '../types';

export class MemoryDriver implements StorageDriver {
  private store = new Map<string, any>();

  get<T>(key: string): T | undefined {
    return this.store.get(key);
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}
