import { Bot, type BotConfig, type Context } from 'grammy';
import { toTelegramError } from '../api';
import type { TelegramDriver, UpdateSink } from '../driver';
import type { TgUpdate, TgUser } from '../types';

export interface GrammyDriverOptions {
  /** grammY `BotConfig` used when the driver creates the `Bot` for you. */
  config?: BotConfig<Context>;
  /**
   * Install a small flood-wait (429) retry transformer on a driver-created bot.
   * Ignored when you pass your own `Bot` (configure its transformers yourself, e.g. with
   * `@grammyjs/auto-retry`). @default true
   */
  autoRetry?: boolean;
}

/**
 * Run Teact on top of grammY.
 *
 * Every update flows through the grammY `Bot`'s middleware first, then into Teact — so
 * grammY plugins you register (sessions, ratelimiter, i18n, logging, `bot.command(...)`)
 * keep working side by side with your React UI. API calls go through `bot.api`, including
 * any transformers you installed.
 *
 * @example Let Teact create the bot
 * import { grammyDriver } from '@teactjs/telegram/grammy';
 * new TelegramAdapter({ driver: grammyDriver() });
 *
 * @example Bring your own (configured) bot
 * const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
 * bot.use(myGrammyMiddleware);
 * new TelegramAdapter({ driver: grammyDriver(bot) });
 */
export function grammyDriver(botOrOptions?: Bot<any> | GrammyDriverOptions): TelegramDriver & { readonly native: Bot<any> } {
  const provided = botOrOptions instanceof Bot ? botOrOptions : undefined;
  const opts: GrammyDriverOptions = botOrOptions instanceof Bot ? {} : (botOrOptions ?? {});
  let bot: Bot<any> | undefined = provided;
  let sinkInstalled = false;
  const pendingMiddleware: unknown[] = [];

  function requireBot(): Bot<any> {
    if (!bot) throw new Error('[teact] grammyDriver used before init().');
    return bot;
  }

  return {
    name: 'grammy',

    get native() {
      return requireBot();
    },

    async init(token) {
      if (!bot) {
        if (!token) throw new Error('[teact] grammyDriver needs a bot token (TELEGRAM_BOT_TOKEN) or a pre-built grammY Bot.');
        bot = new Bot(token, opts.config);
        if (opts.autoRetry !== false) {
          bot.api.config.use(async (prev, method, payload, signal) => {
            for (let attempt = 0; ; attempt++) {
              const res = await prev(method, payload, signal);
              const retryAfter = (res as any)?.parameters?.retry_after;
              if (res.ok || (res as any).error_code !== 429 || attempt >= 3 || !retryAfter || retryAfter > 30) return res;
              await new Promise((r) => setTimeout(r, retryAfter * 1000));
            }
          });
        }
      }
      for (const m of pendingMiddleware.splice(0)) bot.use(m as any);
      await bot.init();
      return bot.botInfo as unknown as TgUser;
    },

    async call(method, params, callOpts) {
      const raw = requireBot().api.raw as unknown as Record<string, (p: unknown, s?: AbortSignal) => Promise<unknown>>;
      const fn = raw[method];
      if (typeof fn !== 'function') throw new Error(`[teact] grammY has no Bot API method "${method}".`);
      try {
        return await fn(params, callOpts?.signal);
      } catch (err) {
        throw toTelegramError(method, err);
      }
    },

    onUpdate(sink: UpdateSink) {
      const b = requireBot();
      if (sinkInstalled) return;
      sinkInstalled = true;
      // Last in the chain: anything the user registered on the grammY bot runs first
      // and can stop propagation by not calling next().
      b.use(async (ctx) => {
        await sink(ctx.update as unknown as TgUpdate, ctx);
      });
    },

    async handleUpdate(update) {
      await requireBot().handleUpdate(update as any);
    },

    use(...middleware) {
      if (sinkInstalled) {
        console.warn('[teact] grammY middleware registered after the bot started will run AFTER Teact; register it before bot.start().');
      }
      if (bot) for (const m of middleware) bot.use(m as any);
      else pendingMiddleware.push(...middleware);
    },
  };
}
