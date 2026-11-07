import type { BotContext, Middleware } from '../renderer';

/**
 * Compose an array of middleware functions into a single middleware.
 *
 * Unlike Koa-style middleware, `next()` is called automatically if
 * the middleware function completes without calling it. This means
 * simple middleware (loggers, analytics) don't need to remember to
 * call `next()` — the framework handles it. Return `false` to stop
 * the chain on purpose (e.g. a rate limiter dropping an update).
 *
 * @param middlewares - Ordered list of middleware to chain.
 * @returns A single middleware that runs the chain in order.
 *
 * @example
 * const logger: Middleware = async (ctx) => {
 *   console.log(ctx.text);  // no need to call next() — it's automatic
 * };
 * const banned: Middleware = (ctx) => {
 *   if (blocklist.has(ctx.userId)) return false;  // stop here
 * };
 */
export function compose(middlewares: Middleware[]): Middleware {
  return async (ctx, next): Promise<void> => {
    let index = -1;
    async function dispatch(i: number): Promise<void> {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      if (i >= middlewares.length) {
        if (next) await next();
        return;
      }
      const fn = middlewares[i];
      let downstream: Promise<void> | undefined;
      const result = await fn(ctx, () => (downstream = dispatch(i + 1)));
      // A middleware that calls next() without awaiting it must not detach the rest of
      // the chain (the per-chat lock and serverless settle wait for this promise).
      if (downstream) await downstream;
      else if (result !== false) await dispatch(i + 1);
    }
    await dispatch(0);
  };
}

/**
 * Middleware that intercepts `/command` messages and dispatches them to registered handlers.
 *
 * @param commands - Map of command names (without `/`) to their handler functions.
 * @returns Middleware that calls the matching handler or passes through via `next()`.
 */
export function commandMiddleware(
  commands: Map<string, (ctx: BotContext, args: string[]) => Promise<void> | void>,
): Middleware {
  return async (ctx, next) => {
    if (ctx.text?.startsWith('/')) {
      const parts = ctx.text.trim().slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase().split('@')[0];
      const handler = commands.get(cmd);
      if (handler) { await handler(ctx, parts.slice(1).filter(Boolean)); return false; }
    }
    await next();
  };
}
