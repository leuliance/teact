import { useBot, useOptionalService, type BotContext, type TeactPlugin } from '@teactjs/core';

/** A flag value: a constant, or a (possibly async) predicate evaluated per update. */
export type FlagValue = boolean | ((ctx: BotContext) => boolean | Promise<boolean>);

/** Options for {@link featureFlags}. */
export interface FeatureFlagsOptions {
  /** Flag definitions. Unknown flags are always `false`. */
  flags: Record<string, FlagValue>;
  /**
   * Percentage rollouts (0–100) per flag. A user is in the rollout when a stable hash
   * of `flag:userId` falls under the percentage, so the same user always gets the same
   * answer. Combined with `flags` using AND; a flag listed only here counts as `true`
   * before the rollout is applied.
   *
   * @example rollout: { newCheckout: 25 } // 25% of users
   */
  rollout?: Record<string, number>;
}

/** The service registered under {@link FEATURE_FLAGS_SERVICE}. */
export interface FeatureFlagsService {
  /** Evaluate a flag for an update (async predicates are awaited). */
  isEnabled(name: string, ctx: BotContext): Promise<boolean>;
  /** Flag value for an update — precomputed by the middleware, sync fallback otherwise. */
  get(name: string, ctx: BotContext): boolean;
}

/** The plugin returned by {@link featureFlags}. */
export type FeatureFlagsPlugin = TeactPlugin & Pick<FeatureFlagsService, 'isEnabled'>;

/** DI key of the feature-flags service. */
export const FEATURE_FLAGS_SERVICE = 'teact-feature-flags';

/** Stable 0–99 bucket for a string (FNV-1a). */
export function rolloutBucket(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * Feature flags with per-user predicates and percentage rollouts. Flags are evaluated
 * once per update by the middleware (async predicates allowed) and read synchronously in
 * components with {@link useFlag}.
 *
 * @example
 * featureFlags({
 *   flags: {
 *     newMenu: true,
 *     betaSearch: (ctx) => BETA_TESTERS.includes(ctx.userId),
 *     premium: async (ctx) => (await db.user(ctx.userId)).premium,
 *   },
 *   rollout: { newMenu: 20 },
 * })
 */
export function featureFlags(options: FeatureFlagsOptions): FeatureFlagsPlugin {
  const names = [...new Set([...Object.keys(options.flags), ...Object.keys(options.rollout ?? {})])];
  const computed = new WeakMap<BotContext, Record<string, boolean>>();

  const inRollout = (name: string, ctx: BotContext): boolean => {
    const pct = options.rollout?.[name];
    if (pct == null) return true;
    return rolloutBucket(`${name}:${ctx.userId}`) < pct;
  };

  const isEnabled = async (name: string, ctx: BotContext): Promise<boolean> => {
    if (!names.includes(name)) return false;
    const def = options.flags[name] ?? true;
    let on: boolean;
    try {
      on = typeof def === 'function' ? Boolean(await def(ctx)) : def;
    } catch (err) {
      console.error(`[teact-feature-flags] flag "${name}" threw — treating as off:`, err);
      on = false;
    }
    return on && inRollout(name, ctx);
  };

  const service: FeatureFlagsService = {
    isEnabled,
    get(name, ctx) {
      const pre = computed.get(ctx);
      if (pre && name in pre) return pre[name];
      // Not precomputed (e.g. rendered outside a normal update): sync evaluation only.
      if (!names.includes(name)) return false;
      const def = options.flags[name] ?? true;
      let on = false;
      if (typeof def === 'function') {
        try {
          const v = def(ctx);
          on = typeof v === 'boolean' ? v : false;
        } catch { on = false; }
      } else on = def;
      return on && inRollout(name, ctx);
    },
  };

  return {
    name: 'teact-feature-flags',
    services: { [FEATURE_FLAGS_SERVICE]: service },
    async middleware(ctx, next) {
      const values = await Promise.all(names.map((n) => isEnabled(n, ctx)));
      computed.set(ctx, Object.fromEntries(names.map((n, i) => [n, values[i]])));
      await next();
    },
    isEnabled,
  };
}

/**
 * Read a feature flag for the current user (requires the {@link featureFlags} plugin).
 *
 * @example
 * function Menu() {
 *   const newMenu = useFlag('newMenu');
 *   return newMenu ? <NewMenu /> : <OldMenu />;
 * }
 */
export function useFlag(name: string): boolean {
  const service = useOptionalService<FeatureFlagsService>(FEATURE_FLAGS_SERVICE);
  const ctx = useBot();
  if (!service) {
    throw new Error('[teact-feature-flags] useFlag() requires the featureFlags() plugin in your plugins array.');
  }
  return service.get(name, ctx);
}
