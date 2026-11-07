import { sharedContext } from './shared-context';

/** Options for how long serverless requests wait for background work to finish. */
export interface SettleOptions {
  /** Consider the bot idle after this long with no in-flight work and no renders. @default 300 */
  idleMs?: number;
  /** Never keep a request alive longer than this. @default 25_000 */
  maxMs?: number;
}

/**
 * Tracks in-flight async work (data fetches, streams, async handlers, sends) so a
 * serverless request can stay alive until the bot has finished reacting to an update —
 * on Workers/Vercel/Lambda the runtime freezes as soon as the response is returned, which
 * would otherwise strand screens on "Loading…" forever.
 */
export class WorkTracker {
  private inflight = 0;
  private lastActivity = 0;

  /** Mark activity (a render, a send) — restarts the idle window. */
  touch(): void {
    this.lastActivity = Date.now();
  }

  /** Track a promise until it settles. Returns the same promise. */
  track<T>(p: Promise<T>): Promise<T> {
    this.inflight++;
    this.touch();
    const done = () => { this.inflight--; this.touch(); };
    p.then(done, done);
    return p;
  }

  get busy(): boolean {
    return this.inflight > 0;
  }

  /**
   * Resolve once nothing has been in flight for `idleMs` (draining `drain()` — e.g. pending
   * send queues — along the way), or after `maxMs`. Resolves `true` if the bot went idle.
   */
  async settle(opts: SettleOptions = {}, drain?: () => Promise<unknown>): Promise<boolean> {
    const idleMs = opts.idleMs ?? 300;
    const deadline = Date.now() + (opts.maxMs ?? 25_000);
    while (Date.now() < deadline) {
      if (drain) await drain();
      const quietFor = Date.now() - this.lastActivity;
      if (!this.busy && quietFor >= idleMs) return true;
      const wait = this.busy ? 25 : Math.max(5, idleMs - quietFor);
      await new Promise((r) => setTimeout(r, Math.min(wait, Math.max(0, deadline - Date.now()))));
    }
    return false;
  }
}

/** Lets data hooks (useQuery, useStream, …) register their work with the bot. */
export const WorkTrackerCtx = sharedContext<WorkTracker | null>('work-tracker', null);

const FETCH_TRACKERS = Symbol.for('teact.fetchTrackers');

/**
 * Count every outgoing `fetch` as tracked work for `tracker` — this covers third-party data
 * libraries (TanStack Query, supabase-js, SDKs) that Teact can't instrument directly.
 * Installed once per runtime; each bot adds its tracker. Returns an uninstaller.
 */
export function trackGlobalFetch(tracker: WorkTracker): () => void {
  const g = globalThis as typeof globalThis & { [FETCH_TRACKERS]?: Set<WorkTracker> };
  if (typeof g.fetch !== 'function') return () => {};
  let trackers = g[FETCH_TRACKERS];
  if (!trackers) {
    trackers = g[FETCH_TRACKERS] = new Set();
    const original = g.fetch.bind(g);
    const set = trackers;
    const wrapped = ((...args: Parameters<typeof fetch>) => {
      const p = original(...args);
      for (const t of set) t.track(p);
      return p;
    }) as typeof fetch;
    g.fetch = Object.assign(wrapped, original);
  }
  trackers.add(tracker);
  return () => { trackers!.delete(tracker); };
}
