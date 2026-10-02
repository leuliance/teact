import { Bot } from 'gramio';
import { TelegramApiError } from '../api';
import type { TelegramDriver, UpdateSink } from '../driver';
import type { TgUpdate, TgUser } from '../types';

export interface GramioDriverOptions {
  /** Options passed to `new Bot(token, options)` when the driver creates the bot. */
  options?: Record<string, any>;
}

function toError(method: string, err: unknown): unknown {
  const e = err as any;
  if (e && typeof e === 'object' && typeof e.code === 'number' && typeof e.message === 'string') {
    return new TelegramApiError(method, e.code, e.message, e.payload, err);
  }
  return err;
}

/**
 * Run Teact on top of GramIO.
 *
 * Every update flows through the GramIO `Bot`'s middleware/plugins first, then into Teact,
 * so GramIO plugins (`.extend(...)`, `.derive(...)`, `.command(...)`) keep working next to
 * your React UI. API calls go through `bot.api`, including its `preRequest`/`onResponse` hooks.
 *
 * @example
 * import { gramioDriver } from '@teactjs/telegram/gramio';
 * new TelegramAdapter({ driver: gramioDriver() });
 *
 * @example Bring your own bot
 * const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!).extend(myPlugin);
 * new TelegramAdapter({ driver: gramioDriver(bot) });
 */
export function gramioDriver(botOrOptions?: Bot<any, any, any> | GramioDriverOptions): TelegramDriver & { readonly native: Bot<any, any, any> } {
  const provided = botOrOptions instanceof Bot ? botOrOptions : undefined;
  const opts: GramioDriverOptions = botOrOptions instanceof Bot ? {} : (botOrOptions ?? {});
  let bot: Bot<any, any, any> | undefined = provided;
  let sinkInstalled = false;
  const pendingMiddleware: unknown[] = [];

  function requireBot(): Bot<any, any, any> {
    if (!bot) throw new Error('[teact] gramioDriver used before init().');
    return bot;
  }

  return {
    name: 'gramio',

    get native() {
      return requireBot();
    },

    async init(token) {
      if (!bot) {
        if (!token) throw new Error('[teact] gramioDriver needs a bot token (TELEGRAM_BOT_TOKEN) or a pre-built GramIO Bot.');
        bot = new Bot(token, opts.options as any);
      }
      for (const m of pendingMiddleware.splice(0)) bot.use(m as any);
      await bot.init();
      return (bot.info ?? (await this.call('getMe', {}))) as TgUser;
    },

    async call(method, params) {
      const api = requireBot().api as unknown as Record<string, (p: unknown) => Promise<unknown>>;
      const fn = api[method];
      if (typeof fn !== 'function') throw new Error(`[teact] GramIO has no Bot API method "${method}".`);
      try {
        return await fn(params);
      } catch (err) {
        throw toError(method, err);
      }
    },

    onUpdate(sink: UpdateSink) {
      const b = requireBot();
      if (sinkInstalled) return;
      sinkInstalled = true;
      b.use(async (context: any) => {
        await sink(context.update as TgUpdate, context);
      });
    },

    async handleUpdate(update) {
      await requireBot().updates.handleUpdate(update as any);
    },

    use(...middleware) {
      if (sinkInstalled) {
        console.warn('[teact] GramIO middleware registered after the bot started will run AFTER Teact; register it before bot.start().');
      }
      if (bot) for (const m of middleware) bot.use(m as any);
      else pendingMiddleware.push(...middleware);
    },
  };
}
