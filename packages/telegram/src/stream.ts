import { stream } from '@grammyjs/stream';
import type { TeactPlugin } from '@teactjs/core';
import type { TelegramAdapter } from './adapter';

/**
 * Grammy stream plugin for Teact.
 *
 * Registers `@grammyjs/stream` on the Grammy bot, enabling `conversation.stream()`
 * for live-updating messages from async generators. Auto-retry is already installed
 * by the adapter's connect(), so it is not registered again here (that would stack
 * retries on 429s).
 *
 * @example
 * plugins: [ streamPlugin() ]
 */
export function streamPlugin(): TeactPlugin {
  return {
    name: 'grammy-stream',
    onStart(adapter) {
      const tg = adapter as TelegramAdapter;
      tg.use(stream());
    },
  };
}
