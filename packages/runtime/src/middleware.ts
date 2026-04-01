import type { BotContext, Middleware } from '@teactjs/renderer';

/**
 * Compose an array of middleware functions into a single middleware.
 *
 * Unlike Koa-style middleware, `next()` is called automatically if
 * the middleware function completes without calling it. This means
 * simple middleware (loggers, analytics) don't need to remember to
 * call `next()` — the framework handles it.
 *
 * @param middlewares - Ordered list of middleware to chain.
 * @returns A single middleware that runs the chain in order.
 *
 * @example
 * const logger: Middleware = async (ctx) => {
 *   console.log(ctx.text);  // no need to call next() — it's automatic
 * };
 */
export function compose(middlewares: Middleware[]): Middleware {
  return async (ctx, next) => {
    let index = -1;
    async function dispatch(i: number): Promise<void> {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      if (i >= middlewares.length) {
        if (next) await next();
        return;
      }
      const fn = middlewares[i];
      let nextCalled = false;
      await fn(ctx, () => { nextCalled = true; return dispatch(i + 1); });
      if (!nextCalled) await dispatch(i + 1);
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
      const parts = ctx.text.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase().split('@')[0];
      const handler = commands.get(cmd);
      if (handler) { await handler(ctx, parts.slice(1)); return; }
    }
    await next();
  };
}
