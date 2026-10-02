import type { BotContext } from '../renderer';
import type { TeactPlugin } from './plugin';

// ---- rateLimitPlugin ----

export interface RateLimitOptions {
  /** Max updates allowed per key within `windowMs`. @default 5 */
  limit?: number;
  /** Window length in ms. @default 2000 */
  windowMs?: number;
  /** What to limit by. @default the user (`ctx.userId`) */
  key?: (ctx: BotContext) => string;
  /**
   * Called (at most once per window per key) when an update is dropped. Return a string to
   * reply with it, e.g. `() => 'Slow down a little 🐢'`.
   */
  onLimited?: (ctx: BotContext) => void | string | Promise<void | string>;
}

/**
 * Drop updates from users who send too many too fast (spam, double-taps, scripts).
 * Dropped updates never reach commands, conversations or your components. Button taps are
 * still acknowledged, so spinners don't hang.
 *
 * @example
 * plugins: [rateLimitPlugin({ limit: 3, windowMs: 1000, onLimited: () => 'Easy there! ⏳' })]
 */
export function rateLimitPlugin(options: RateLimitOptions = {}): TeactPlugin {
  const limit = options.limit ?? 5;
  const windowMs = options.windowMs ?? 2000;
  const keyOf = options.key ?? ((ctx: BotContext) => `${ctx.platform}:${ctx.userId}`);
  const hits = new Map<string, { stamps: number[]; warnedAt: number }>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    if (now - lastSweep < windowMs * 10) return;
    lastSweep = now;
    for (const [k, v] of hits) if (!v.stamps.length || now - v.stamps[v.stamps.length - 1] > windowMs) hits.delete(k);
  }

  return {
    name: 'rate-limit',
    middleware: async (ctx) => {
      const now = Date.now();
      sweep(now);
      const key = keyOf(ctx);
      let entry = hits.get(key);
      if (!entry) hits.set(key, (entry = { stamps: [], warnedAt: 0 }));
      while (entry.stamps.length && now - entry.stamps[0] >= windowMs) entry.stamps.shift();
      if (entry.stamps.length < limit) {
        entry.stamps.push(now);
        return;
      }
      if (options.onLimited && now - entry.warnedAt >= windowMs) {
        entry.warnedAt = now;
        try {
          const reply = await options.onLimited(ctx);
          if (typeof reply === 'string' && ctx.api) {
            await ctx.api.call('sendMessage', {
              chat_id: ctx.chatId,
              text: reply,
              ...(ctx.threadId != null ? { message_thread_id: ctx.threadId } : {}),
            });
          }
        } catch (err) {
          console.error('[teact] rateLimitPlugin onLimited failed:', err);
        }
      }
      return false;
    },
  };
}

// ---- loggerPlugin ----

export interface LoggerOptions {
  /** Where log lines go. @default console.log */
  log?: (line: string, ctx: BotContext, durationMs: number) => void;
}

function describe(ctx: BotContext): string {
  const who = ctx.user.username ? `@${ctx.user.username}` : ctx.user.firstName ?? ctx.userId;
  const what = ctx.callbackData != null
    ? `tap ${JSON.stringify(ctx.callbackData)}`
    : ctx.text != null
      ? JSON.stringify(ctx.text.length > 60 ? `${ctx.text.slice(0, 57)}…` : ctx.text)
      : ctx.updateType ?? 'update';
  return `${who} in ${ctx.chatId}: ${what}`;
}

/**
 * Log every update with who sent it, what it was, and how long handling took.
 *
 * @example
 * plugins: [loggerPlugin()]
 * // [teact] ← @ada in 12345: "/start" (38ms)
 * // [teact] ← @ada in 12345: tap "__cb:«r1»" (12ms)
 */
export function loggerPlugin(options: LoggerOptions = {}): TeactPlugin {
  const log = options.log ?? ((line: string) => console.log(line));
  return {
    name: 'logger',
    middleware: async (ctx, next) => {
      const start = Date.now();
      try {
        await next();
      } finally {
        const ms = Date.now() - start;
        log(`[teact] ← ${describe(ctx)} (${ms}ms)`, ctx, ms);
      }
    },
  };
}
