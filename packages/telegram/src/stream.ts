import { stream } from '@grammyjs/stream';
import { autoRetry } from '@grammyjs/auto-retry';
import type { TeactPlugin } from '@teactjs/core';
import type { TelegramAdapter } from './adapter';

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
      const tg = adapter as TelegramAdapter;
      const bot = tg.getBot();
      bot.api.config.use(autoRetry());
      tg.use(stream());
    },
  };
}
