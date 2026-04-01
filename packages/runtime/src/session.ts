import type { SessionData, SessionStore } from '@teact/renderer';

/**
 * In-memory session store with TTL-based expiration.
 * Used as the default when no custom `SessionStore` is provided.
 *
 * @example
 * const store = new MemorySessionStore(30 * 60 * 1000); // 30-minute TTL
 */
export class MemorySessionStore implements SessionStore {
  private store = new Map<string, { data: SessionData; expiresAt: number }>();
  private ttl: number;

  /** @param ttl - Time-to-live in milliseconds (default: 24 hours). */
  constructor(ttl = 24 * 60 * 60 * 1000) {
    this.ttl = ttl;
  }

  async get(key: string): Promise<SessionData | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  async set(key: string, data: SessionData): Promise<void> {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}
