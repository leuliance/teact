import type { FunctionComponent, ReactNode } from 'react';
import type { BotContext, Middleware } from '@teact/renderer';
import type { TelegramAdapter } from '@teact/telegram';

/**
 * Teact plugin interface.
 * Plugins can hook into the bot lifecycle, provide middleware,
 * and wrap the component tree with React providers.
 *
 * @example
 * export function myPlugin(opts: MyOpts): TeactPlugin {
 *   return {
 *     name: 'my-plugin',
 *     Provider: ({ children }) => <MyContext.Provider value={...}>{children}</MyContext.Provider>,
 *     middleware: async (ctx, next) => { ... ; await next(); },
 *     onStart: (adapter) => console.log('bot started!'),
 *   };
 * }
 */
export interface TeactPlugin {
  name: string;
  /** Called when the bot starts. Receives the adapter for advanced setup. */
  onStart?: (adapter: TelegramAdapter) => Promise<void> | void;
  /** Middleware that runs on every update before the component renders. */
  middleware?: Middleware;
  /** React provider component that wraps the app tree. Receives children. */
  Provider?: FunctionComponent<{ children: ReactNode }>;
  /** Cleanup when the bot stops. */
  onStop?: () => Promise<void> | void;
}
