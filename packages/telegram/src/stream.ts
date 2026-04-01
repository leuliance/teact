import { stream } from '@grammyjs/stream';
import { autoRetry } from '@grammyjs/auto-retry';
import type { TeactPlugin } from '@teact/runtime';

/**
 * Grammy stream plugin for Teact.
 *
 * Registers `@grammyjs/stream` and `@grammyjs/auto-retry` on the Grammy bot.
 * Enables `conversation.stream()` for live-updating messages from async generators.
 *
 * @example
 * plugins: [ streamPlugin() ]
 */
export function streamPlugin(): TeactPlugin {
  return {
    name: 'grammy-stream',
    onStart(adapter) {
      const bot = adapter.getBot();
      bot.api.config.use(autoRetry());
      adapter.use(stream());
    },
  };
}
