import React, { useState, useContext, useCallback, createContext } from 'react';
import type { FunctionComponent, ReactElement } from 'react';
import { RuntimeContext } from './context';

// ---- Types ----

/**
 * Determines how the router transitions between messages.
 * - `replace` — edit the current message in-place
 * - `push` — keep old message, send a new one below
 * - `stack` — strip buttons from old message, send new one below
 * - `dismiss` — strip buttons from old message, do NOT send a new one
 */
export type NavigateMode = 'replace' | 'push' | 'stack' | 'dismiss';

/**
 * Extracts `:param` names from a route template into a typed params object.
 *
 * @example
 * type P = PathParams<'/pokemon/:id'>;          // { id: string }
 * type Q = PathParams<'/team/:tid/member/:mid'>; // { tid: string; mid: string }
 */
export type PathParams<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof PathParams<`/${Rest}`>]: string }
    : P extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<never, string>;

export interface NavigateOptions {
  /** How to handle the previous message (default: 'replace').
   *  - replace: edit the current message in-place
   *  - push:    keep old message, send a new one below
   *  - stack:   strip buttons from old message, send new one below
   *  - dismiss: strip buttons from old message, do NOT send a new one */
  mode?: NavigateMode;
}

/** Button definition used in guard replies and redirects. */
export interface GuardButton {
  text: string;
  route?: string;
  url?: string;
}

/** Options for the `reply` helper inside `beforeLoad`. */
export interface GuardReplyOptions {
  buttons?: GuardButton[][];
}

const GUARD_REPLY_SYMBOL = Symbol.for('teact.guardReply');

/** Sentinel object returned by the `reply()` helper inside `beforeLoad`. */
export interface GuardReply {
  readonly __type: typeof GUARD_REPLY_SYMBOL;
  text: string;
  buttons?: GuardButton[][];
}

function createGuardReply(text: string, options?: GuardReplyOptions): GuardReply {
  return { __type: GUARD_REPLY_SYMBOL, text, buttons: options?.buttons };
}

/** Context passed to route guards in `beforeLoad`. */
export interface BeforeLoadContext {
  path: string;
  params: Record<string, string>;
  session: Record<string, any>;
  /** Send a message (with optional buttons) instead of loading the route. */
  reply: (text: string, options?: GuardReplyOptions) => GuardReply;
}

/** Object returned from a route guard to trigger a redirect with an optional message. */
export interface GuardRedirect {
  redirect: string;
  message?: string;
  buttons?: GuardButton[][];
}

/** Object returned from a guard to render a component instead of the target route. */
export interface GuardComponent {
  component: FunctionComponent<any>;
}

/**
 * A route guard function that runs before the route loads.
 *
 * @example
 * // Redirect to home
 * beforeLoad: ({ session }) => {
 *   if (!session.auth) return redirect('/');
 * }
 *
 * // Return JSX directly
 * beforeLoad: ({ session }) => {
 *   if (!session.auth) return <LoginPage />;
 * }
 *
 * // Reply with a message and buttons (same API as command handlers)
 * beforeLoad: ({ session, reply }) => {
 *   if (!session.auth) return reply('Please log in.', {
 *     buttons: [[{ text: 'Login', route: '/login' }, { text: 'Menu', route: '/' }]],
 *   });
 * }
 */
export type RouteGuard = (
  ctx: BeforeLoadContext,
) => void | string | GuardRedirect | GuardComponent | GuardReply | ReactElement;

/**
 * A route value: either a plain component or an object with `component` and optional `beforeLoad` guard.
 *
 * @example
 * const routes = {
 *   '/': Home,
 *   '/admin': { component: Admin, beforeLoad: ({ session }) => session.admin ? undefined : '/' },
 * };
 */
/** A bot command co-located with the route it opens. */
export interface RouteCommand {
  /** The command name without the leading slash (e.g. `'pokedex'` for `/pokedex`). */
  name: string;
  /** Description shown in Telegram's command menu. */
  description: string;
  /** Resolve deep-link args (e.g. `/start payload`) to a route path. */
  deepLink?: (args: string[]) => string;
}

/** Command shape the router hands to the bot engine (structurally a CommandDef). */
export interface ResolvedRouteCommand {
  description: string;
  route: string;
  deepLink?: (args: string[]) => string;
}

export type RouteValue =
  | FunctionComponent<any>
  | { component: FunctionComponent<any>; beforeLoad?: RouteGuard; command?: RouteCommand };

export interface RouteDefinition {
  path: string;
  component: FunctionComponent<any>;
  pattern: RegExp;
  paramNames: string[];
  beforeLoad?: RouteGuard;
}

export interface RouterConfig {
  routes: RouteDefinition[];
  defaultRoute: string;
  notFound: FunctionComponent<any>;
  /** Commands co-located on routes via `command:`, collected for the bot engine. */
  commands: Record<string, ResolvedRouteCommand>;
}

interface RouterContextValue {
  path: string;
  params: Record<string, string>;
  navigate: (path: string, opts?: NavigateOptions) => void;
}

/** Mutable ref shared between the router and the commit callback. */
export interface CommitModeRef {
  current: NavigateMode;
}

export const RouterCtx = createContext<RouterContextValue | null>(null);

export const CommitModeCtx = createContext<CommitModeRef>({ current: 'replace' });

/** Redirect helper for use inside `beforeLoad` guards. */
export function redirect(path: string): string {
  return path;
}

function DefaultNotFound(): React.ReactElement {
  return React.createElement(
    'tg-message',
    { text: '🔍 Page not found\n\nThe page you\'re looking for doesn\'t exist.\nUse /start to go back to the menu.' },
  );
}

// ---- Route parsing ----

function parseRoute(path: string, component: FunctionComponent<any>, beforeLoad?: RouteGuard): RouteDefinition {
  if (path === '/') {
    return { path, component, pattern: /^\/$/, paramNames: [], beforeLoad };
  }

  const paramNames: string[] = [];
  const patternParts = path
    .split('/')
    .filter(Boolean)
    .map(seg => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

  return {
    path,
    component,
    pattern: new RegExp(`^/${patternParts.join('/')}$`),
    paramNames,
    beforeLoad,
  };
}

function matchRoute(
  routes: RouteDefinition[],
  path: string,
): { route: RouteDefinition; params: Record<string, string> } | null {
  // Normalize a trailing slash (except the root) so `/pokemon/` matches `/pokemon`.
  // Easy to produce accidentally via string concatenation in deep-link resolvers.
  const normalized = path.length > 1 ? (path.replace(/\/+$/, '') || '/') : path;
  for (const r of routes) {
    const m = normalized.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = m[i + 1];
      });
      return { route: r, params };
    }
  }
  return null;
}

interface ResolvedRoute {
  route: RouteDefinition;
  params: Record<string, string>;
  path: string;
}

type GuardOverride =
  | { guardComponent: FunctionComponent<any>; params: Record<string, string>; path: string }
  | { guardElement: ReactElement; params: Record<string, string>; path: string }
  | { guardReply: GuardReply; params: Record<string, string>; path: string };

function isReactElement(value: unknown): value is ReactElement {
  return value != null && typeof value === 'object' && '$$typeof' in (value as any);
}

function isGuardReply(value: unknown): value is GuardReply {
  return value != null && typeof value === 'object' && (value as any).__type === GUARD_REPLY_SYMBOL;
}

function resolveRoute(
  config: RouterConfig,
  path: string,
  session: Record<string, any>,
): ResolvedRoute | GuardOverride | null {
  const MAX_REDIRECTS = 5;
  let currentPath = path;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const match = matchRoute(config.routes, currentPath);
    if (!match) return null;

    if (match.route.beforeLoad) {
      let result: ReturnType<RouteGuard>;
      try {
        result = match.route.beforeLoad({
          path: currentPath,
          params: match.params,
          session,
          reply: createGuardReply,
        });
      } catch (err) {
        // A guard threw. Fail closed (render notFound) rather than leaking the guarded
        // component — a thrown auth guard must never fall through to the protected page.
        console.error(`[teact] beforeLoad guard for "${match.route.path}" threw:`, err);
        return null;
      }
      const p = match.params, cur = currentPath;
      if (typeof result === 'string' && result !== currentPath) {
        currentPath = result;
        continue;
      }
      if (isGuardReply(result)) {
        return { guardReply: result, params: p, path: cur };
      }
      if (isReactElement(result)) {
        return { guardElement: result, params: p, path: cur };
      }
      if (result && typeof result === 'object') {
        if ('redirect' in result) {
          currentPath = (result as GuardRedirect).redirect;
          continue;
        }
        if ('component' in result) {
          return { guardComponent: (result as GuardComponent).component, params: p, path: cur };
        }
      }
    }
    return { route: match.route, params: match.params, path: currentPath };
  }
  console.warn(
    `[teact] Router redirect loop: exceeded ${MAX_REDIRECTS} redirects starting from "${path}". ` +
    'Check your beforeLoad guards for a cycle. Showing the notFound page.',
  );
  return null;
}

// ---- Public API ----

/** Options for `createRouter`. */
export interface CreateRouterOptions {
  /** Component to render when no route matches (custom 404 page). */
  notFound?: FunctionComponent<any>;
}

/**
 * Create a router from a route map.
 *
 * Routes can be plain components or objects with `beforeLoad` guards.
 * Pass a `notFound` component as the second argument for custom 404 pages:
 *
 * ```tsx
 * createRouter(
 *   {
 *     '/': Home,
 *     '/admin': { component: AdminPanel, beforeLoad: ({ session }) => {
 *       if (!session.loggedIn) return redirect('/');
 *     }},
 *   },
 *   { notFound: NotFoundPage },
 * );
 * ```
 */
export function createRouter<const T extends Record<string, RouteValue>>(
  routes: T,
  options?: CreateRouterOptions,
): RouterConfig {
  const defs: RouteDefinition[] = [];
  const commands: Record<string, ResolvedRouteCommand> = {};

  for (const [path, value] of Object.entries(routes)) {
    const component = typeof value === 'function' ? value : value.component;
    const guard = typeof value === 'function' ? undefined : value.beforeLoad;
    defs.push(parseRoute(path, component, guard));

    if (typeof value === 'object' && value.command) {
      const { name, description, deepLink } = value.command;
      commands[name] = { description, route: path, ...(deepLink ? { deepLink } : {}) };
    }
  }
  const defaultPath = defs.find(d => d.path === '/')?.path ?? defs[0]?.path ?? '/';
  // Match more specific routes first: deeper paths win, and at equal depth a static
  // route (fewer params) beats a param route — so `/pokemon/list` isn't shadowed by
  // `/pokemon/:id` (which would otherwise match `list` as an id).
  defs.sort((a, b) => {
    const segDiff = b.path.split('/').length - a.path.split('/').length;
    if (segDiff !== 0) return segDiff;
    return a.paramNames.length - b.paramNames.length;
  });
  return { routes: defs, defaultRoute: defaultPath, notFound: options?.notFound ?? DefaultNotFound, commands };
}

// ---- Internal provider ----

export function RouterProvider({
  config,
  initialPath,
}: {
  config: RouterConfig;
  initialPath: string;
}): React.ReactElement | null {
  const commitMode = useContext(CommitModeCtx);
  const runtime = useContext(RuntimeContext);
  const [nav, setNav] = useState({ path: initialPath, tick: 0 });

  const navigate = useCallback(
    (path: string, opts?: NavigateOptions) => {
      commitMode.current = opts?.mode ?? 'replace';
      setNav(prev => ({ path, tick: prev.tick + 1 }));
    },
    [commitMode],
  );

  const resolved = resolveRoute(config, nav.path, runtime?.session ?? {});
  const providerValue = { path: nav.path, params: {} as Record<string, string>, navigate };

  if (!resolved) {
    return React.createElement(RouterCtx.Provider, { value: providerValue }, React.createElement(config.notFound));
  }

  // Guard-rendered routes still carry the matched URL's params, so a component/element
  // shown by a guard can read useParams() (e.g. an /order/:id preview for logged-out users).
  const guardValue = { path: resolved.path, params: resolved.params, navigate };

  if ('guardComponent' in resolved) {
    return React.createElement(RouterCtx.Provider, { value: guardValue }, React.createElement(resolved.guardComponent));
  }

  if ('guardElement' in resolved) {
    return React.createElement(RouterCtx.Provider, { value: guardValue }, resolved.guardElement);
  }

  if ('guardReply' in resolved) {
    const { text, buttons } = resolved.guardReply;
    const children: React.ReactElement[] = [];
    if (buttons?.length) {
      const rows = buttons.map((row, ri) =>
        React.createElement('tg-button-row', { key: ri },
          ...row.map((btn, bi) =>
            React.createElement('tg-button', {
              key: bi,
              text: btn.text,
              url: btn.url,
              callbackData: btn.route ? `__route:${btn.route}` : undefined,
            }),
          ),
        ),
      );
      children.push(React.createElement('tg-keyboard', { key: 'kbd' }, ...rows));
    }
    const msg = React.createElement('tg-message', { text }, ...children);
    return React.createElement(RouterCtx.Provider, { value: guardValue }, msg);
  }

  return React.createElement(
    RouterCtx.Provider,
    { value: { path: resolved.path, params: resolved.params, navigate } },
    React.createElement(resolved.route.component),
  );
}

// ---- Hooks ----

/** Navigate to a different route.
 *  @example
 *  navigate('/pokemon/25')                       // replace current message
 *  navigate('/pokemon/25', { mode: 'push' })     // keep old message, send new below
 *  navigate('/pokemon/25', { mode: 'stack' })    // strip buttons from old, send new below
 *  navigate('/pokemon/25', { mode: 'dismiss' })  // strip buttons only, no new message
 */
export function useNavigate(): (path: string, opts?: NavigateOptions) => void {
  const ctx = useContext(RouterCtx);
  if (!ctx) throw new Error('useNavigate must be used inside a Router');
  return ctx.navigate;
}

/**
 * Read the current route's dynamic parameters.
 *
 * Pass the route template as a type argument to infer param names (no codegen):
 *
 * @example
 * // Route: '/pokemon/:id'
 * const { id } = useParams<'/pokemon/:id'>();   // id: string, type-checked
 * const params = useParams();                    // Record<string, string> (loose)
 */
export function useParams<P extends string = never>(): [P] extends [never]
  ? Record<string, string>
  : PathParams<P> {
  const ctx = useContext(RouterCtx);
  if (!ctx) throw new Error('useParams must be used inside a Router');
  return ctx.params as any;
}

/**
 * Returns the current matched path and params.
 *
 * @returns An object with `path` and `params`.
 */
export function useRoute(): { path: string; params: Record<string, string> } {
  const ctx = useContext(RouterCtx);
  if (!ctx) throw new Error('useRoute must be used inside a Router');
  return { path: ctx.path, params: ctx.params };
}
