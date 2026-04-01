import type { TeactPlugin } from './plugin';
import type { WebhookConfig } from './bot';
import type { Middleware, SessionStore } from '@teactjs/renderer';

/**
 * Infrastructure configuration for `teact.config.ts`.
 * Commands and app logic belong in `createBot()` — this is for deployment settings only.
 */
export interface TeactConfig {
  /** Transport mode. @default 'polling' */
  mode?: 'polling' | 'webhook';
  /** Webhook server settings (required when `mode` is `'webhook'`). */
  webhook?: WebhookConfig;
  /** Plugins loaded at startup (e.g. `storagePlugin()`, `authPlugin()`). */
  plugins?: TeactPlugin[];
  /** Global middleware that runs on every update. */
  middleware?: Middleware[];
  /** Session store override and TTL. */
  session?: { store?: SessionStore; ttl?: number };
}

/**
 * Type-safe config helper for `teact.config.ts`.
 * Infrastructure-only — commands live in createBot() on the React side.
 *
 * @example
 * // teact.config.ts
 * import { defineConfig } from '@teactjs/core';
 * import { storagePlugin } from '@teactjs/storage';
 *
 * export default defineConfig({
 *   mode: 'polling',
 *   plugins: [storagePlugin()],
 * });
 */
export function defineConfig(config: TeactConfig): TeactConfig {
  return config;
}
