import type { TeactPlugin } from '@teactjs/core';

/**
 * @deprecated Streaming is built in: `conversation.stream()` works on every driver and
 * `useStream()` streams inside components. This plugin is now a no-op kept for
 * backwards compatibility — remove it from your plugins array.
 */
export function streamPlugin(): TeactPlugin {
  return { name: 'teact-stream' };
}
