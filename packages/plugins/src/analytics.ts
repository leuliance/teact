import { useCallback } from 'react';
import { useBot, useOptionalService, type BotContext, type TeactPlugin } from '@teactjs/core';
import type { AnyStorageDriver } from '@teactjs/storage';
import { KeyedMutex, commandName, createKV, updateKind } from './utils';

/** An analytics event — built-in (`update`) or custom (from {@link useTrack}). */
export interface AnalyticsEvent {
  /** `'update'` for every incoming update, or your custom event name. */
  name: string;
  platform: string;
  chatId: string;
  userId: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Built-in `update` events carry `{ type, command? }`. */
  properties?: Record<string, unknown>;
}

/** Aggregated counters returned by `getStats()`. */
export interface AnalyticsStats {
  /** Day the per-day numbers refer to (`YYYY-MM-DD`, UTC). */
  day: string;
  /** All updates ever counted. */
  updates: number;
  /** Updates on `day`. */
  updatesOnDay: number;
  /** Distinct users who sent at least one update on `day`. */
  uniqueUsers: number;
  /** Command usage counts, by command name (without `/`). */
  commands: Record<string, number>;
  /** Custom event counts (from `useTrack` / `track`), by event name. */
  events: Record<string, number>;
}

/** Options for {@link analytics}. */
export interface AnalyticsOptions {
  /** Forward every event to your analytics backend (PostHog, Mixpanel, a DB…). Errors are logged, not thrown. */
  track?: (event: AnalyticsEvent) => void | Promise<void>;
  /** Driver for the built-in counters (share it across instances, e.g. Redis). Default: memory. */
  storage?: AnyStorageDriver;
  /** Key prefix in `storage`. Default `'teact:analytics:'`. */
  prefix?: string;
  /** How long per-day counters are kept, in days. Default `90`. */
  retentionDays?: number;
}

/** The service registered under {@link ANALYTICS_SERVICE}. */
export interface AnalyticsService {
  /** Record a custom event for an update context. */
  track(name: string, ctx: BotContext, properties?: Record<string, unknown>): Promise<void>;
  /** Read the built-in counters. `day` defaults to today (UTC), format `YYYY-MM-DD`. */
  getStats(day?: string): Promise<AnalyticsStats>;
}

/** The plugin returned by {@link analytics} — a `TeactPlugin` plus the service API. */
export type AnalyticsPlugin = TeactPlugin & AnalyticsService;

/** DI key of the analytics service. */
export const ANALYTICS_SERVICE = 'teact-analytics';

const DAY_MS = 86_400_000;
/** Most distinct command / event names kept in the stats maps; the rest count as `'(other)'`. */
export const MAX_NAMES = 100;
const OTHER = '(other)';
const COMMAND_RE = /^[a-z0-9_]{1,32}$/;
const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * Usage analytics. Counts every update (total and per day), command usage and unique
 * users per day, forwards events to an optional `track` sink, and lets components
 * record custom events with {@link useTrack}. Read the counters with `getStats()`.
 *
 * Counters live in `storage` (default: memory) — pass a shared driver (Redis…) to
 * aggregate across instances. Totals, daily counts and unique users use the driver's
 * atomic `incr()` when it has one (Redis, Postgres, SQLite, D1, MongoDB), so instances
 * never lose increments. Recording runs alongside your handlers rather than before them,
 * and only well-formed command names are counted (at most {@link MAX_NAMES} distinct).
 *
 * @example
 * const stats = analytics({ track: (e) => posthog.capture({ distinctId: e.userId, event: e.name, properties: e.properties }) });
 * createBot({ plugins: [stats], commands: { stats: { description: 'Stats', handler: async (c) => c.reply(JSON.stringify(await stats.getStats())) } } });
 */
export function analytics(options: AnalyticsOptions = {}): AnalyticsPlugin {
  const kv = createKV(options.storage, options.prefix ?? 'teact:analytics:');
  const lock = new KeyedMutex();
  const retention = (options.retentionDays ?? 90) * DAY_MS;

  const incr = (key: string, ttl?: number) => kv.incr(key, ttl);

  /**
   * Count `name` under `group` ('commands' / 'events'). Each name has its own atomic
   * counter (`<group>:#<name>`); `<group>` itself only lists the known names, so it is
   * written once per new name. At most MAX_NAMES names; the rest count as '(other)'.
   */
  const incrIn = async (group: string, name: string) => {
    const names = (await kv.get<string[]>(group)) ?? [];
    if (!names.includes(name) && names.length >= MAX_NAMES) name = OTHER;
    if ((await kv.incr(`${group}:#${name}`)) === 1 || !names.includes(name)) {
      await lock.run(group, async () => {
        const current = (await kv.get<string[]>(group)) ?? [];
        if (!current.includes(name)) await kv.set(group, [...current, name]);
      });
    }
  };

  const readGroup = async (group: string): Promise<Record<string, number>> => {
    const names = (await kv.get<string[]>(group)) ?? [];
    const counts = await Promise.all(names.map((n) => kv.get<number>(`${group}:#${n}`)));
    // fromEntries defines own properties, so a name like '__proto__' can't touch the prototype.
    return Object.fromEntries(names.map((n, i) => [n, counts[i] ?? 0] as const).filter(([, c]) => c > 0));
  };

  const emit = async (event: AnalyticsEvent) => {
    if (!options.track) return;
    try {
      await options.track(event);
    } catch (err) {
      console.error('[teact-analytics] track() failed:', err);
    }
  };

  const recordUpdate = async (ctx: BotContext) => {
    const now = Date.now();
    const day = dayOf(now);
    const raw = commandName(ctx);
    // Only Telegram-shaped command names: anything else would let users grow the map.
    const cmd = raw && COMMAND_RE.test(raw) ? raw : undefined;
    const tasks: Promise<unknown>[] = [incr('updates'), incr(`updates:${day}`, retention)];
    if (cmd) tasks.push(incrIn('commands', cmd));
    const seenKey = `seen:${day}:${ctx.platform}:${ctx.userId}`;
    tasks.push(
      (async () => {
        // First hit of the day for this user (atomic when the driver has incr()).
        if ((await kv.incr(seenKey, 2 * DAY_MS)) === 1) await incr(`users:${day}`, retention);
      })(),
    );
    await Promise.all(tasks);
    const properties: Record<string, unknown> = { type: updateKind(ctx) };
    if (cmd) properties.command = cmd;
    await emit({ name: 'update', platform: ctx.platform, chatId: ctx.chatId, userId: ctx.userId, timestamp: now, properties });
  };

  const service: AnalyticsService = {
    async track(name, ctx, properties) {
      try {
        await incrIn('events', name);
      } catch (err) {
        console.error('[teact-analytics] failed to count event:', err);
      }
      await emit({ name, platform: ctx.platform, chatId: ctx.chatId, userId: ctx.userId, timestamp: Date.now(), properties });
    },
    async getStats(day = dayOf(Date.now())) {
      const [updates, updatesOnDay, uniqueUsers, commands, events] = await Promise.all([
        kv.get<number>('updates'),
        kv.get<number>(`updates:${day}`),
        kv.get<number>(`users:${day}`),
        readGroup('commands'),
        readGroup('events'),
      ]);
      return {
        day,
        updates: updates ?? 0,
        updatesOnDay: updatesOnDay ?? 0,
        uniqueUsers: uniqueUsers ?? 0,
        commands,
        events,
      };
    },
  };

  return {
    name: 'teact-analytics',
    services: { [ANALYTICS_SERVICE]: service },
    async middleware(ctx, next) {
      // Record in parallel with the rest of the pipeline (no added latency), but await it
      // before the update finishes so the counts survive on serverless.
      const recording = recordUpdate(ctx).catch((err) => {
        console.error('[teact-analytics] failed to record update:', err);
      });
      try {
        await next();
      } finally {
        await recording;
      }
    },
    track: service.track,
    getStats: service.getStats,
  };
}

/**
 * Record custom analytics events from a component (requires the {@link analytics} plugin).
 * Returns a stable `track(name, properties?)` bound to the current user/chat. Call it from
 * event handlers (`onClick`), not during render.
 *
 * @example
 * const track = useTrack();
 * <Button text="Buy" onClick={() => { track('purchase_clicked', { plan: 'pro' }); buy(); }} />
 */
export function useTrack(): (name: string, properties?: Record<string, unknown>) => Promise<void> {
  const service = useOptionalService<AnalyticsService>(ANALYTICS_SERVICE);
  const ctx = useBot();
  if (!service) {
    throw new Error('[teact-analytics] useTrack() requires the analytics() plugin in your plugins array.');
  }
  return useCallback((name, properties) => service.track(name, ctx, properties), [service, ctx]);
}
