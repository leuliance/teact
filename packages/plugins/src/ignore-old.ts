import { halt, type BotContext, type TeactPlugin } from '@teactjs/core';
import { updateDateOf } from './utils';

/** Options for {@link ignoreOld}. */
export interface IgnoreOldOptions {
  /** Max age in **seconds**. Older messages are dropped. Default `300` (5 minutes). */
  maxAge?: number;
  /** Called for every dropped update (e.g. to log it). `age` is in seconds. */
  onIgnored?: (ctx: BotContext, age: number) => void;
}

/**
 * Drop messages older than `maxAge` seconds — after downtime Telegram delivers the whole
 * backlog, and answering hour-old `/start`s is confusing (and floods the API).
 *
 * The date comes from the raw message (`ctx.raw.msg.date` / `ctx.raw.message.date`, Unix
 * seconds). Updates without a date — notably callback queries — always pass.
 *
 * @example
 * ignoreOld({ maxAge: 60 })
 */
export function ignoreOld(options: IgnoreOldOptions = {}): TeactPlugin {
  const maxAge = options.maxAge ?? 300;
  return {
    name: 'teact-ignore-old',
    async middleware(ctx, next) {
      const date = updateDateOf(ctx);
      if (date != null) {
        const age = Date.now() / 1000 - date;
        if (age > maxAge) {
          halt(ctx);
          options.onIgnored?.(ctx, age);
          return;
        }
      }
      await next();
    },
  };
}
