import React, { Suspense } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import { createRoot, type TeactRoot, type OutputNode, type BotContext, type SessionStore, type SessionData, type Middleware, type Adapter } from '../renderer';
import { CallbackRegistryCtx, ErrorBoundary, type CallbackMap } from '../renderer';

/** Minimal internal Suspense fallback — a raw host element so core never imports @teactjs/ui. */
const InternalSuspenseFallback = () =>
  React.createElement('tg-message', { text: '⏳ Loading…' });
import { RuntimeContext, type RuntimeContextValue } from './context';
import { ServicesCtx, type ServiceMap } from './services';
import { MemorySessionStore } from './session';
import { compose } from './middleware';
import { RouterProvider, CommitModeCtx, type RouterConfig, type NavigateMode, type CommitModeRef } from './router';
import type { TeactPlugin } from './plugin';
import type { TeactConfig } from './config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Filesystem is only available on Node/Bun. Serverless/edge (Cloudflare Workers,
// Deno Deploy, Vercel Edge) has none — every fs call below is guarded so it can't
// throw there (an uncaught throw would 500 the webhook).
const HAS_FS = (() => {
  try {
    // Cloudflare Workers expose this; treat as no-fs even under nodejs_compat.
    if (typeof navigator !== 'undefined' && (navigator as any).userAgent === 'Cloudflare-Workers') return false;
    return typeof process !== 'undefined' && typeof (readFileSync as unknown) === 'function';
  } catch { return false; }
})();

// ---- .env auto-loader ----

function loadEnvFile(): void {
  if (!HAS_FS) return;
  try {
    const content = readFileSync('.env', 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnvFile();

// ---- Auto-load teact.config ----

async function loadTeactConfig(): Promise<TeactConfig> {
  if (!HAS_FS) return {};
  try {
    for (const name of ['teact.config.ts', 'teact.config.js', 'teact.config.mjs']) {
      const fullPath = resolve(process.cwd(), name);
      if (existsSync(fullPath)) {
        try {
          const mod = await import(pathToFileURL(fullPath).href);
          console.log(`[teact] Loaded ${name}`);
          return mod.default ?? mod;
        } catch (err) {
          console.warn(`[teact] Failed to load ${name}:`, err);
        }
      }
    }
  } catch {}
  return {};
}

// ---- HMR-safe global instance ----
// When vite-node --watch re-executes the file, stop the previous bot first.

const GLOBAL_KEY = '__teact_bot_instance__';

async function cleanupPreviousInstance(): Promise<void> {
  const prev = (globalThis as any)[GLOBAL_KEY];
  if (prev && typeof prev.stop === 'function') {
    console.log('[teact] Hot-reloading — stopping previous instance…');
    try { await prev.stop(); } catch {}
  }
}

function registerGlobalInstance(instance: any): void {
  (globalThis as any)[GLOBAL_KEY] = instance;
}

// ---- Types ----

/** A button in an inline keyboard sent via {@link CommandContext.reply}. */
export interface ReplyButton {
  text: string;
  url?: string;
  route?: string;
}

/** A button in a custom reply keyboard sent via {@link CommandContext.reply}. */
export interface ReplyKeyboardButton {
  text: string;
  requestContact?: boolean;
  requestLocation?: boolean;
}

/** Options for {@link CommandContext.reply}. */
export interface ReplyOptions {
  /** Inline keyboard rows. */
  buttons?: ReplyButton[][];
  /** Custom reply keyboard rows. */
  replyKeyboard?: ReplyKeyboardButton[][];
}

/** Context object passed to command handlers defined in `commands`. */
export interface CommandContext {
  args: string[];
  reply: (text: string, options?: ReplyOptions) => Promise<void>;
  chatId: string;
  user: { id: string; username?: string; firstName?: string };
  platform: string;
  raw: any;
}

/**
 * Definition of a bot command registered via `createBot({ commands })`.
 *
 * @example
 * const commands = {
 *   start: { description: 'Start the bot', route: '/' },
 *   help:  { description: 'Show help', handler: 'Use /start to begin.' },
 *   echo:  { description: 'Echo args', handler: async (ctx) => ctx.reply(ctx.args.join(' ')) },
 * };
 */
export interface CommandDef {
  description: string;
  /** A static string reply, or an async handler function. */
  handler?: string | ((ctx: CommandContext) => Promise<void> | void);
  /** Route to navigate to when the command is triggered. */
  route?: string;
  /** Resolve deep-link parameters (e.g. `/start payload`) into a route path. */
  deepLink?: (args: string[]) => string;
}

/** Webhook server configuration for production deployments. */
export interface WebhookConfig {
  domain: string;
  port?: number;
  path?: string;
  secretToken?: string;
}

/**
 * Options for {@link createBot}.
 *
 * @example
 * createBot({
 *   adapter: new TelegramAdapter(),
 *   router: createRouter({ '/': Home }),
 *   commands: { start: { description: 'Start', route: '/' } },
 * });
 */
export interface CreateBotOptions {
  component?: FunctionComponent<any>;
  router?: RouterConfig;
  providers?: FunctionComponent<{ children: ReactNode }>;
  adapter: Adapter;
  token?: string;
  /** @default 'polling' — overrides teact.config */
  mode?: 'polling' | 'webhook';
  /** Webhook configuration — overrides teact.config */
  webhook?: WebhookConfig;
  session?: { store?: SessionStore; ttl?: number };
  /** Additional middleware — merged with teact.config middleware */
  middleware?: Middleware[];
  /** Additional plugins — merged with teact.config plugins */
  plugins?: TeactPlugin[];
  /** Bot commands (stays in the React/app layer, not in config) */
  commands?: Record<string, CommandDef>;
  /** Experimental feature flags for opt-in features. */
  experimental?: Record<string, unknown>;
  /**
   * Enable verbose debug logging.
   * Logs every incoming update, render cycle, middleware execution, and errors
   * with timestamps so you can diagnose stuck bots or unexpected behavior.
   * @default false
   */
  debug?: boolean;
}

// ---- Internals ----

interface ChatRoot {
  root: TeactRoot;
  handlers: CallbackMap;
  chatId: string;
  lastMessageId?: number;
  commitQueue: Promise<void>;
  commitMode: CommitModeRef;
  /** Set when a render threw; the next update rebuilds a fresh root to recover. */
  errored?: boolean;
  /**
   * Resolved by onCommit once a render has committed (and its send task has been
   * appended to commitQueue). renderForChat awaits this so the send is guaranteed
   * to be enqueued before bot.fetch() returns — essential on serverless/edge, where
   * the isolate freezes after the Response and a not-yet-scheduled send would be lost.
   */
  commitSignal?: () => void;
}

interface ActiveSession {
  session: SessionData;
  /** Chain of pending session writes for this update, in call order. */
  write: Promise<unknown>;
}

interface CommandInfo {
  name: string;
  args: string[];
  initialRoute?: string;
}

/** Options for `bot.fetch(request, options)`. */
export interface BotFetchOptions {
  /** Bot token (e.g. `env.TELEGRAM_BOT_TOKEN`). Falls back to `createBot({ token })` / `TELEGRAM_BOT_TOKEN`. */
  token?: string;
  /** Webhook secret; requests whose `X-Telegram-Bot-Api-Secret-Token` header differs get a 401. */
  secretToken?: string;
  /**
   * Platform bindings for this request (the Cloudflare Workers `env`). Read them anywhere
   * with {@link getEnv} — e.g. `new D1Driver(() => getEnv<Env>().DB)` at module scope.
   */
  env?: unknown;
}

let currentEnv: unknown;
function setEnv(env: unknown) { currentEnv = env; }

/**
 * The `env` passed to the most recent `bot.fetch(request, { env })` — on Cloudflare
 * Workers, your bindings (D1, KV, secrets). Lets drivers and stores created at module
 * scope reach bindings lazily, without importing `cloudflare:workers` (which would break
 * `bun dev`). Throws if called before the first `bot.fetch` with an `env`.
 *
 * @example
 * export const bot = createBot({
 *   session: { store: d1SessionStore(() => getEnv<Env>().DB) },
 *   plugins: [storagePlugin({ driver: new D1Driver(() => getEnv<Env>().DB) })],
 *   // ...
 * });
 */
export function getEnv<T = Record<string, unknown>>(): T {
  if (currentEnv === undefined) {
    throw new Error('[teact] getEnv() has no env yet — pass it with bot.fetch(request, { env }).');
  }
  return currentEnv as T;
}

/** Callback-data prefix used to encode "navigate to this route" buttons. */
export const ROUTE_PREFIX = '__route:';

/** Safety timeout for awaiting a render commit; see renderForChat for why it's generous. */
const COMMIT_BACKSTOP_MS = 10_000;

function buildMessageNode(text: string, buttons?: ReplyButton[][], replyKeyboard?: ReplyKeyboardButton[][]): OutputNode {
  const children: OutputNode[] = [];
  if (buttons?.length) {
    const rows: OutputNode[] = buttons.map(row => ({
      type: 'tg-button-row',
      props: {},
      children: row.map(btn => ({
        type: 'tg-button',
        props: {
          text: btn.text,
          url: btn.url,
          callbackData: btn.route ? `${ROUTE_PREFIX}${btn.route}` : btn.text,
        },
        children: [],
      })),
    }));
    children.push({ type: 'tg-keyboard', props: {}, children: rows });
  }
  if (replyKeyboard?.length) {
    const rows: OutputNode[] = replyKeyboard.map(row => ({
      type: 'tg-reply-row',
      props: {},
      children: row.map(btn => ({
        type: 'tg-reply-button',
        props: { text: btn.text, requestContact: btn.requestContact, requestLocation: btn.requestLocation },
        children: [],
      })),
    }));
    children.push({ type: 'tg-reply-keyboard', props: { resizeKeyboard: true }, children: rows });
  }
  return { type: 'tg-message', props: { text }, children };
}

// ---- createBot ----

/**
 * Create and configure a Teact bot instance.
 *
 * Provide either a `component` (single-page) or a `router` (multi-page) for the UI.
 * Call `.start()` on the returned object to connect and begin processing updates.
 *
 * @param options - Bot configuration including adapter, component/router, commands, and plugins.
 * @returns A bot instance with `start()` and `stop()` methods.
 *
 * @example
 * const bot = createBot({
 *   adapter: new TelegramAdapter(),
 *   router: createRouter({ '/': Home, '/settings': Settings }),
 *   commands: {
 *     start: { description: 'Start the bot', route: '/' },
 *     settings: { description: 'Open settings', route: '/settings' },
 *   },
 * });
 *
 * bot.start();
 */
export function createBot(options: CreateBotOptions) {
  if (!options.component && !options.router) {
    throw new Error('[teact] Provide either `component` or `router` in createBot options.');
  }

  const adapter = options.adapter;
  const debugMode = options.debug ?? false;
  // Token is resolved lazily: on serverless (Cloudflare Workers etc.) there is no
  // process.env at module load — bot.fetch(request, { token }) supplies it per request.
  let resolvedToken: string | undefined =
    options.token ??
    (typeof process !== 'undefined' ? process.env?.TELEGRAM_BOT_TOKEN : undefined) ??
    (adapter.requiresToken === false ? 'test-token' : undefined);

  function debugLog(...args: any[]) {
    if (debugMode) console.log(`[teact:debug ${new Date().toISOString()}]`, ...args);
  }

  const chatRoots = new Map<string, ChatRoot>();
  // The session of each chat's latest update (see renderForChat).
  const activeSessions = new Map<string, ActiveSession>();
  // Serializes updates per chat: a chat's next update waits for its previous one to
  // finish rendering + sending. Without this, two rapid messages/callbacks for the same
  // chat interleave and race on the shared ChatRoot (commitSignal, commitMode, handlers).
  const chatLocks = new Map<string, Promise<void>>();
  let warnedMemoryStoreOnEdge = false;
  let disposed = false;
  let initPromise: Promise<void> | null = null;
  let webhookFn: ((request: Request) => Promise<Response>) | null = null;

  // These are mutable — they get merged with teact.config during initialize()
  let rawCommands: Record<string, CommandDef> = options.commands ?? {};
  let plugins: TeactPlugin[] = [];
  let userMiddleware: Middleware[] = [];
  let pluginMiddleware: Middleware[] = [];
  let mergedServices: ServiceMap = {};
  let sessionStore: SessionStore = new MemorySessionStore(options.session?.ttl);
  let loadedConfig: TeactConfig = {};

  function resetChatRoot(ctx: BotContext) {
    const chatKey = `${ctx.platform}:${ctx.chatId}`;
    const existing = chatRoots.get(chatKey);
    if (existing) {
      existing.root.unmount();
      chatRoots.delete(chatKey);
    }
  }

  function buildCommandContext(botCtx: BotContext, args: string[]): CommandContext {
    return {
      args,
      reply: async (text: string, opts?: ReplyOptions) => {
        await adapter.send(Number(botCtx.chatId), buildMessageNode(text, opts?.buttons, opts?.replyKeyboard));
      },
      chatId: botCtx.chatId,
      user: botCtx.user,
      platform: botCtx.platform,
      raw: botCtx.raw,
    };
  }

  /**
   * Entry point for every incoming update. Serializes updates per chat so concurrent
   * events for the same chat can't race on the shared ChatRoot; different chats still
   * run concurrently. The adapter awaits the returned promise (important on serverless
   * where the isolate freezes once the Response resolves).
   */
  function handleUpdate(botCtx: BotContext): Promise<void> {
    const chatKey = `${botCtx.platform}:${botCtx.chatId}`;
    const prev = chatLocks.get(chatKey) ?? Promise.resolve();
    const tail = prev.then(() => processUpdate(botCtx));
    chatLocks.set(chatKey, tail);
    // Prune the lock once settled, unless another update has already queued behind us.
    tail.finally(() => {
      if (chatLocks.get(chatKey) === tail) chatLocks.delete(chatKey);
    });
    return tail;
  }

  async function processUpdate(botCtx: BotContext): Promise<void> {
    const updateStart = Date.now();
    debugLog('update received', {
      chatId: botCtx.chatId,
      text: botCtx.text,
      callbackData: botCtx.callbackData,
      hasRaw: !!botCtx.raw,
    });
    try {
      let commandInfo: CommandInfo | undefined;
      let finalStep: (() => Promise<void>) | undefined;

      if (botCtx.callbackData?.startsWith('__convo:')) {
        console.warn(
          `[teact] Received conversation callback "${botCtx.callbackData}" but no conversationsPlugin is registered.\n` +
          '  → Add conversationsPlugin() to your plugins array in teact.config.ts.',
        );
        return;
      }

      // Resetting the chat's root (a new command or route button) is deferred to the end of
      // the middleware pipeline, so an update a middleware halts (rate limit,
      // maintenance…) leaves the chat's current screen and button handlers intact.
      let reset = false;

      if (botCtx.callbackData?.startsWith(ROUTE_PREFIX)) {
        const routePath = botCtx.callbackData.slice(ROUTE_PREFIX.length);
        reset = true;
        commandInfo = { name: '', args: [], initialRoute: routePath };
      } else if (botCtx.text?.startsWith('/')) {
        const [cmdPart, ...args] = botCtx.text.slice(1).split(/\s+/);
        const cmdName = cmdPart.split('@')[0].toLowerCase();
        const cmdDef = rawCommands[cmdName];

        if (cmdDef) {
          reset = true;

          if (cmdDef.handler != null) {
            const handler = cmdDef.handler;
            // Handler commands still go through middleware (rate limits, maintenance,
            // logging, error reporting…); the handler replaces the render step.
            finalStep = async () => {
              if (typeof handler === 'string') {
                await adapter.send(Number(botCtx.chatId), buildMessageNode(handler));
              } else {
                await handler(buildCommandContext(botCtx, args));
              }
            };
          } else {
            let initialRoute: string | undefined;
            if (cmdDef.deepLink && args.length > 0) {
              initialRoute = cmdDef.deepLink(args);
            }
            initialRoute ??= cmdDef.route;
            commandInfo = { name: cmdName, args, initialRoute };
          }
        }
      }

      debugLog('running middleware pipeline', { middlewareCount: pluginMiddleware.length + userMiddleware.length });
      const pipeline = compose([
        ...pluginMiddleware,
        ...userMiddleware,
        async (ctx) => {
          if (reset) resetChatRoot(ctx);
          return finalStep ? finalStep() : renderForChat(ctx, commandInfo);
        },
      ]);
      await pipeline(botCtx, async () => {});
      debugLog(`update processed in ${Date.now() - updateStart}ms`);
    } catch (err) {
      console.error('[teact] Error handling update:', err);
      debugLog('update failed', { error: (err as Error).message, stack: (err as Error).stack });
    }
  }

  async function renderForChat(
    botCtx: BotContext,
    commandInfo?: CommandInfo,
  ): Promise<void> {
    const chatKey = `${botCtx.platform}:${botCtx.chatId}`;
    const session = (await sessionStore.get(chatKey)) ?? {};
    let chatState = chatRoots.get(chatKey);

    // Recover from a previous render error: rebuild a fresh root so the chat isn't
    // permanently stuck showing the error boundary fallback.
    if (chatState?.errored) {
      chatState.root.unmount();
      chatRoots.delete(chatKey);
      chatState = undefined;
    }

    // The session for THIS update. It is registered per chat before any handler runs:
    // onClick handlers were created by an earlier render and hold that render's
    // updateSession, so updateSession always resolves the chat's *current* session
    // instead of the object it closed over. Writes are chained so they land in order,
    // and the whole chain is awaited before we return — on serverless the isolate
    // freezes once the Response resolves, so a fire-and-forget set() to an async store
    // (KV, Redis, DB) would be dropped.
    const active: ActiveSession = { session, write: Promise.resolve() };
    activeSessions.set(chatKey, active);

    const runtimeValue: RuntimeContextValue = {
      botCtx,
      session,
      updateSession(patch) {
        const current = activeSessions.get(chatKey) ?? active;
        Object.assign(current.session, patch);
        // Snapshot so later mutations of the session don't leak into an in-flight write.
        const snapshot = { ...current.session };
        current.write = current.write.then(() => sessionStore.set(chatKey, snapshot));
      },
      command: commandInfo ? { name: commandInfo.name, args: commandInfo.args } : null,
    };

    if (botCtx.callbackData) {
      const handler = chatState?.handlers.get(botCtx.callbackData);
      if (handler) handler();
      else if (botCtx.callbackData.startsWith('__cb:')) {
        // onClick handlers live in this process's memory. After a restart, or on a fresh
        // serverless isolate, they are gone: the screen is re-rendered from its initial
        // state instead (in place — see lastMessageId below).
        console.warn(
          `[teact] No handler for button "${botCtx.callbackData}" in chat ${botCtx.chatId} (bot restarted or new ` +
          'serverless instance) — re-rendering the screen. Use route buttons (<Button route="/x" />) or keep ' +
          'screen state in useSession/useStorage so buttons keep working across instances.',
        );
      }
    }

    if (!chatState) {
      const handlers: CallbackMap = new Map();
      const chatId = botCtx.chatId;
      const commitMode: CommitModeRef = { current: 'replace' };

      const root = createRoot((tree: OutputNode) => {
        if (disposed) return;
        const cs = chatRoots.get(chatKey);
        // Ignore commits from a root that is no longer the chat's current one: unmounting
        // the old root on a reset (new command, route button) commits an empty tree,
        // which must not be sent through the new root's queue.
        if (!cs || cs.root !== root) return;

        cs.commitQueue = cs.commitQueue.then(async () => {
          if (disposed) return;
          const mode = cs.commitMode.current;
          cs.commitMode.current = 'replace';

          try {
            switch (mode) {
              case 'dismiss': {
                if (cs.lastMessageId) {
                  await adapter.clearButtons(Number(chatId), cs.lastMessageId);
                }
                break;
              }
              case 'push': {
                const msgId = await adapter.send(Number(chatId), tree);
                if (msgId) cs.lastMessageId = msgId;
                break;
              }
              case 'stack': {
                if (cs.lastMessageId) {
                  await adapter.clearButtons(Number(chatId), cs.lastMessageId);
                }
                const msgId = await adapter.send(Number(chatId), tree);
                if (msgId) cs.lastMessageId = msgId;
                break;
              }
              default: {
                if (cs.lastMessageId && adapter.canEdit(tree, Number(chatId))) {
                  await adapter.edit(Number(chatId), cs.lastMessageId, tree);
                } else {
                  const msgId = await adapter.send(Number(chatId), tree);
                  if (msgId) cs.lastMessageId = msgId;
                }
                break;
              }
            }
          } catch (err) {
            if (disposed) return;
            // 'dismiss' only clears buttons — a failure there must NOT turn into a
            // surprise full message the user never expected. Only fall back to send
            // for modes that were already trying to render a message.
            if (mode === 'dismiss') {
              console.error('[teact] Failed to dismiss keyboard:', err);
              return;
            }
            try {
              const msgId = await adapter.send(Number(chatId), tree);
              if (msgId) cs.lastMessageId = msgId;
            } catch (e) {
              console.error('[teact] Send fallback failed:', e);
            }
          }
        });

        // Wake any renderForChat awaiting this commit: the send task is now queued.
        cs.commitSignal?.();
      });

      chatState = { root, handlers, chatId, lastMessageId: undefined, commitQueue: Promise.resolve(), commitMode };
      chatRoots.set(chatKey, chatState);
    }

    if (!botCtx.callbackData) {
      chatState.lastMessageId = undefined;
    } else if (!chatState.lastMessageId && Number(botCtx.messageId)) {
      // A button press on a root this process didn't render (route button, restart, fresh
      // serverless isolate): edit the message the button lives on instead of sending a
      // duplicate below it.
      chatState.lastMessageId = Number(botCtx.messageId);
    }

    chatState.handlers.clear();

    let rootElement: React.ReactElement;

    if (options.router) {
      const initialPath = commandInfo?.initialRoute ?? options.router.defaultRoute;
      rootElement = React.createElement(RouterProvider, { config: options.router, initialPath });
    } else {
      rootElement = React.createElement(options.component!, {});
    }

    for (const plugin of plugins) {
      if (plugin.Provider) {
        rootElement = React.createElement(plugin.Provider, null, rootElement);
      }
    }

    if (options.providers) {
      rootElement = React.createElement(options.providers, null, rootElement);
    }

    const wrappedElement = React.createElement(
      ErrorBoundary,
      {
        onError: (err: Error) => {
          console.error(`[teact] Render error in chat ${chatState.chatId}:`, err);
          // Mark the root so the NEXT update rebuilds it fresh. Otherwise the
          // ErrorBoundary stays in its error state forever and sticks the chat.
          const cs = chatRoots.get(chatKey);
          if (cs) cs.errored = true;
        },
      },
      React.createElement(
        Suspense,
        { fallback: React.createElement(InternalSuspenseFallback, null) },
        rootElement,
      ),
    );

    const element = React.createElement(
      ServicesCtx.Provider,
      { value: mergedServices },
      React.createElement(
        CallbackRegistryCtx.Provider,
        { value: { handlers: chatState.handlers } },
        React.createElement(
          RuntimeContext.Provider,
          { value: runtimeValue },
          React.createElement(
            CommitModeCtx.Provider,
            { value: chatState.commitMode },
            wrappedElement,
          ),
        ),
      ),
    );

    debugLog('rendering', { chatId: botCtx.chatId, hasRouter: !!options.router, plugins: plugins.length });

    // The reconciler commits asynchronously (scheduleMicrotask), so we can't await
    // commitQueue immediately — the send task isn't appended until onCommit runs. Instead
    // wait for onCommit to signal (send task queued), THEN await the queue for the actual
    // send/edit. Critical on serverless/edge: once bot.fetch() resolves its Response the
    // isolate may freeze, so the send must complete before we return. A short timer guards
    // against a render that bails out with no commit (nothing to send) so we never hang.
    const cs = chatState;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const committed = new Promise<void>((resolve) => {
      cs.commitSignal = resolve;
      // Backstop only: renderForChat always renders a fresh element (new context
      // identities), so the root always commits and commitSignal always fires. This
      // timer just prevents a permanent hang in the pathological no-commit case
      // (e.g. disposed mid-render). It must be long enough never to cut off a real
      // (possibly Suspense-delayed) commit — the previous 100ms value did exactly that.
      commitTimer = setTimeout(() => {
        debugLog('commit backstop fired — no commit observed', { chatId: botCtx.chatId });
        resolve();
      }, COMMIT_BACKSTOP_MS);
    });
    cs.root.render(element);
    await committed;
    if (commitTimer) clearTimeout(commitTimer);
    cs.commitSignal = undefined;
    await cs.commitQueue;
    // Ensure any session write triggered by this render (or its onClick handler) is
    // durably persisted before we return — critical on serverless (see above).
    await active.write;
    if (activeSessions.get(chatKey) === active) activeSessions.delete(chatKey);
  }

  async function registerCommandMenu(): Promise<number> {
    const botCommands = Object.entries(rawCommands).map(([name, def]) => ({
      command: name,
      description: def.description,
    }));
    if (botCommands.length === 0) return 0;
    await adapter.setCommands(botCommands);
    console.log(`[teact] Registered ${botCommands.length} command(s) with Telegram`);
    return botCommands.length;
  }

  /**
   * One-time setup shared by start() (polling/webhook server) and fetch() (serverless):
   * load config, merge plugins, connect the adapter, run onStart, wire update handlers.
   * Memoized so serverless cold-starts initialize exactly once.
   */
  async function initialize(opts?: { registerCommands?: boolean }): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // Auto-load teact.config.ts (fs-based; harmlessly returns {} on serverless/edge).
      loadedConfig = await loadTeactConfig();

      // A plugin listed in BOTH teact.config.ts and createBot({ plugins }) is loaded once,
      // and the explicit createBot() copy wins — otherwise you'd get two driver instances,
      // doubled Providers and duplicated onStart/onStop. Repeats within one list are
      // intentional (e.g. a per-user and a per-chat rateLimit) and are all kept.
      const botPlugins = options.plugins ?? [];
      const botNames = new Set(botPlugins.map((p) => p.name));
      plugins = [
        ...(loadedConfig.plugins ?? []).filter((p) => {
          if (!botNames.has(p.name)) return true;
          console.warn(`[teact] Plugin "${p.name}" is in both teact.config.ts and createBot({ plugins }) — using the createBot() one.`);
          return false;
        }),
        ...botPlugins,
      ];
      pluginMiddleware = plugins.filter(p => p.middleware).map(p => p.middleware!);
      mergedServices = Object.assign({}, ...plugins.map(p => p.services ?? {}));
      userMiddleware = [...(loadedConfig.middleware ?? []), ...(options.middleware ?? [])];

      // Commands: co-located router `command:` entries first, then explicit createBot commands.
      rawCommands = { ...(options.router?.commands ?? {}), ...(options.commands ?? {}) };

      if (options.session?.store) sessionStore = options.session.store;
      else if (loadedConfig.session?.store) sessionStore = loadedConfig.session.store;

      if (!resolvedToken) {
        throw new Error('[teact] No bot token. Pass createBot({ token }), bot.fetch(req, { token }), or set TELEGRAM_BOT_TOKEN.');
      }
      await adapter.connect({ token: resolvedToken });

      for (const plugin of plugins) {
        if (plugin.onStart) {
          try { await plugin.onStart(adapter); }
          catch (err) { console.error(`[teact] Plugin "${plugin.name}" onStart failed:`, err); }
        }
      }

      // Register the platform command menu (skipped on serverless by default — set it
      // once at deploy time instead of on every cold start).
      if (opts?.registerCommands !== false) {
        try {
          await registerCommandMenu();
        } catch (err) {
          console.warn('[teact] Could not set bot commands:', err);
        }
      }

      adapter.on('message', (ctx: BotContext) => handleUpdate(ctx));
      adapter.on('callback_query', (ctx: BotContext) => handleUpdate(ctx));
    })();
    return initPromise;
  }

  const botInstance = {
    async start() {
      // 0. Stop any previous instance (HMR / vite-node --watch)
      await cleanupPreviousInstance();
      registerGlobalInstance(botInstance);

      if (!resolvedToken) {
        console.error('[teact] No bot token found. Add TELEGRAM_BOT_TOKEN to your .env file.');
        process.exit(1);
      }

      await initialize({ registerCommands: true });

      const mode = options.mode ?? loadedConfig.mode ?? 'polling';
      const webhook = options.webhook ?? loadedConfig.webhook;
      if (mode === 'webhook' && webhook) {
        await adapter.listen({ webhook });
      } else {
        await adapter.listen({ polling: true });
      }

      // 5. Graceful shutdown
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        console.log('\n[teact] Shutting down…');
        await botInstance.stop();
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);

      console.log(`[teact] Bot started (${mode})${debugMode ? ' [debug mode]' : ''}`);
      if (debugMode) {
        console.log('[teact:debug] Debug mode enabled — verbose logging active');
        console.log('[teact:debug] Config:', {
          mode,
          commands: Object.keys(rawCommands),
          plugins: plugins.map(p => p.name),
          middleware: userMiddleware.length + pluginMiddleware.length,
        });
      }
    },

    async stop() {
      disposed = true;

      for (const [, cs] of chatRoots) cs.root.unmount();
      chatRoots.clear();

      for (const plugin of plugins) {
        if (plugin.onStop) {
          try {
            await plugin.onStop();
          } catch (err) {
            console.error(`[teact] Plugin "${plugin.name}" onStop failed:`, err);
          }
        }
      }

      await adapter.disconnect();
      console.log('[teact] Bot stopped');
    },

    /**
     * Serverless / edge webhook entry: `(request) => Response`. Initializes the bot
     * once (lazily) and processes a single Telegram update per request — no polling,
     * no long-running server. Works on Cloudflare Workers, Vercel/Deno Edge,
     * Bun.serve, Netlify, etc.
     *
     * @example Cloudflare Worker (src/worker.ts)
     * export default {
     *   fetch: (request: Request, env: Env) =>
     *     bot.fetch(request, { token: env.TELEGRAM_BOT_TOKEN, secretToken: env.WEBHOOK_SECRET }),
     * };
     */
    async fetch(request: Request, opts?: BotFetchOptions): Promise<Response> {
      // Reject requests without the webhook secret before doing any work (no getMe, no
      // plugin onStart) — anyone can POST to a public worker URL.
      if (opts?.secretToken && request.headers.get('x-telegram-bot-api-secret-token') !== opts.secretToken) {
        return new Response('Unauthorized', { status: 401 });
      }
      if (opts?.env !== undefined) setEnv(opts.env);
      if (opts?.token) resolvedToken = opts.token;
      await initialize({ registerCommands: false });
      // The in-memory session store is per-isolate; on serverless each request may get
      // a fresh isolate, so sessions silently never persist. Warn once so this doesn't
      // masquerade as a working bot in production.
      if (!warnedMemoryStoreOnEdge && sessionStore instanceof MemorySessionStore) {
        warnedMemoryStoreOnEdge = true;
        console.warn(
          '[teact] Running on the edge with the default in-memory session store — ' +
          'sessions will NOT persist between requests. Pass a durable store via ' +
          'createBot({ session: { store } }) (e.g. a KV/Redis-backed SessionStore).',
        );
      }
      if (!webhookFn) {
        if (!adapter.webhookCallback) {
          throw new Error('[teact] The configured adapter does not support serverless webhooks (no webhookCallback).');
        }
        webhookFn = adapter.webhookCallback({ secretToken: opts?.secretToken });
      }
      return webhookFn(request);
    },

    /**
     * Register the commands with the platform's command menu (Telegram `setMyCommands`).
     * `start()` does this automatically; `fetch()` (serverless) doesn't, to avoid a call on
     * every cold start — run this once after deploying, e.g. from a script or `teact`.
     * Resolves the number of commands registered.
     */
    async setCommands(): Promise<number> {
      await initialize({ registerCommands: false });
      return registerCommandMenu();
    },

    _chatRoots: chatRoots,
    // Getter so callers see the store actually in use after initialize() may have
    // replaced the default with one from createBot({ session }) or teact.config.ts.
    get _sessionStore() { return sessionStore; },
  };

  return botInstance;
}
