import { definePlugin } from '@teactjs/plugin-sdk';

/**
 * A tiny custom plugin built with the Teact plugin SDK — exactly how a
 * third-party plugin (supabase, cloudflare, a backend client, …) is authored.
 *
 * - middleware: logs every update
 * - service: exposes a counter readable anywhere via `useService('analytics')`
 */
export interface Analytics {
  hits: number;
  track(event: string): void;
}

export const analyticsPlugin = definePlugin<{ verbose?: boolean }>({
  name: 'analytics',
  defaultConfig: { verbose: false },
  setup(ctx) {
    const analytics: Analytics = {
      hits: 0,
      track(event) {
        analytics.hits++;
        if (ctx.config.verbose) console.log(`[analytics] ${event} (#${analytics.hits})`);
      },
    };

    ctx.provideService('analytics', analytics);

    ctx.middleware(async (update, next) => {
      analytics.track(update.callbackData ?? update.text ?? 'update');
      await next();
    });

    ctx.onStart(() => console.log('[analytics] plugin ready'));
  },
});
