import { halt, type TeactPlugin } from '@teactjs/core';
import { AdapterRef, idSet, type Reply } from './utils';

/** Options for {@link maintenance}. */
export interface MaintenanceOptions {
  /** Static switch. Default `true` (if you register the plugin, it's on). Ignored when `isEnabled` is set. */
  enabled?: boolean;
  /**
   * Dynamic switch, checked on every update — read an env var, a feature-flag service,
   * a DB row… Return `true` to put the bot in maintenance mode.
   */
  isEnabled?: () => boolean | Promise<boolean>;
  /** Reply sent to blocked users. Default: a short "under maintenance" notice. `null` = silent. */
  message?: Reply | null;
  /** User ids that bypass maintenance mode (admins / testers). */
  allow?: Array<string | number>;
}

/** Default maintenance notice. */
export const DEFAULT_MAINTENANCE_MESSAGE = '🛠 The bot is under maintenance. Please try again a bit later.';

/**
 * Maintenance mode: while enabled, every update from a user not in `allow` is blocked
 * (component not rendered) and answered with `message`.
 *
 * @example
 * maintenance({
 *   isEnabled: () => process.env.MAINTENANCE === '1',
 *   allow: [123456789],
 *   message: '🛠 Back in 10 minutes!',
 * })
 */
export function maintenance(options: MaintenanceOptions = {}): TeactPlugin {
  const allow = idSet(options.allow) ?? new Set<string>();
  const message = options.message === undefined ? DEFAULT_MAINTENANCE_MESSAGE : options.message;
  const ref = new AdapterRef();

  return {
    name: 'teact-maintenance',
    onStart(adapter) { ref.adapter = adapter; },
    async middleware(ctx, next) {
      const on = options.isEnabled ? await options.isEnabled() : (options.enabled ?? true);
      if (!on || allow.has(String(ctx.userId))) return next();
      halt(ctx);
      await ref.send(ctx, message ?? undefined, 'teact-maintenance');
    },
  };
}
