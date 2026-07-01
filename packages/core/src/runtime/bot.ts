import React, { Suspense } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import { createRoot, type TeactRoot, type OutputNode, type BotContext, type SessionStore, type Middleware, type Adapter } from '../renderer';
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

interface CommandInfo {
  name: string;
  args: string[];
  initialRoute?: string;
}

/** Callback-data prefix used to encode "navigate to this route" buttons. */
export const ROUTE_PREFIX = '__route:';

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
    options.token ?? (typeof process !== 'undefined' ? process.env?.TELEGRAM_BOT_TOKEN : undefined);

  function debugLog(...args: any[]) {
    if (debugMode) console.log(`[teact:debug ${new Date().toISOString()}]`, ...args);
  }

  const chatRoots = new Map<string, ChatRoot>();
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

  async function handleUpdate(botCtx: BotContext): Promise<void> {
    const updateStart = Date.now();
    debugLog('update received', {
      chatId: botCtx.chatId,
      text: botCtx.text,
      callbackData: botCtx.callbackData,
      hasRaw: !!botCtx.raw,
    });
    try {
      let commandInfo: CommandInfo | undefined;

      if (botCtx.callbackData?.startsWith('__convo:')) {
        console.warn(
          `[teact] Received conversation callback "${botCtx.callbackData}" but no conversationsPlugin is registered.\n` +
          '  → Add conversationsPlugin() to your plugins array in teact.config.ts.',
        );
        return;
      }

      if (botCtx.callbackData?.startsWith(ROUTE_PREFIX)) {
        const routePath = botCtx.callbackData.slice(ROUTE_PREFIX.length);
        resetChatRoot(botCtx);
        commandInfo = { name: '', args: [], initialRoute: routePath };
      } else if (botCtx.text?.startsWith('/')) {
        const [cmdPart, ...args] = botCtx.text.slice(1).split(/\s+/);
        const cmdName = cmdPart.split('@')[0].toLowerCase();
        const cmdDef = rawCommands[cmdName];

        if (cmdDef) {
          resetChatRoot(botCtx);

          if (cmdDef.handler != null) {
            if (typeof cmdDef.handler === 'string') {
              await adapter.send(Number(botCtx.chatId), buildMessageNode(cmdDef.handler));
            } else {
              await cmdDef.handler(buildCommandContext(botCtx, args));
            }
            return;
          }

          let initialRoute: string | undefined;
          if (cmdDef.deepLink && args.length > 0) {
            initialRoute = cmdDef.deepLink(args);
          }
          initialRoute ??= cmdDef.route;
          commandInfo = { name: cmdName, args, initialRoute };
        }
      }

      debugLog('running middleware pipeline', { middlewareCount: pluginMiddleware.length + userMiddleware.length });
      const pipeline = compose([
        ...pluginMiddleware,
        ...userMiddleware,
        async (ctx) => renderForChat(ctx, commandInfo),
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

    if (botCtx.callbackData && chatState) {
      const handler = chatState.handlers.get(botCtx.callbackData);
      if (handler) handler();
    }

    const runtimeValue: RuntimeContextValue = {
      botCtx,
      session,
      updateSession(patch) {
        Object.assign(session, patch);
        sessionStore.set(chatKey, session);
      },
      command: commandInfo ? { name: commandInfo.name, args: commandInfo.args } : null,
    };

    if (!chatState) {
      const handlers: CallbackMap = new Map();
      const chatId = botCtx.chatId;
      const commitMode: CommitModeRef = { current: 'replace' };

      const root = createRoot((tree: OutputNode) => {
        if (disposed) return;
        const cs = chatRoots.get(chatKey);
        if (!cs) return;

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
                if (cs.lastMessageId && adapter.canEdit(tree)) {
                  await adapter.edit(Number(chatId), cs.lastMessageId, tree);
                } else {
                  const msgId = await adapter.send(Number(chatId), tree);
                  if (msgId) cs.lastMessageId = msgId;
                }
                break;
              }
            }
          } catch {
            if (disposed) return;
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
      commitTimer = setTimeout(resolve, 100);
    });
    cs.root.render(element);
    await committed;
    if (commitTimer) clearTimeout(commitTimer);
    cs.commitSignal = undefined;
    await cs.commitQueue;
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

      plugins = [...(loadedConfig.plugins ?? []), ...(options.plugins ?? [])];
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
        const botCommands = Object.entries(rawCommands).map(([name, def]) => ({
          command: name,
          description: def.description,
        }));
        if (botCommands.length > 0) {
          try {
            await adapter.setCommands(botCommands);
            console.log(`[teact] Registered ${botCommands.length} command(s) with Telegram`);
          } catch (err) {
            console.warn('[teact] Could not set bot commands:', err);
          }
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
    async fetch(request: Request, opts?: { token?: string; secretToken?: string }): Promise<Response> {
      if (opts?.token) resolvedToken = opts.token;
      await initialize({ registerCommands: false });
      if (!webhookFn) {
        if (!adapter.webhookCallback) {
          throw new Error('[teact] The configured adapter does not support serverless webhooks (no webhookCallback).');
        }
        webhookFn = adapter.webhookCallback({ secretToken: opts?.secretToken });
      }
      return webhookFn(request);
    },

    _chatRoots: chatRoots,
    _sessionStore: sessionStore,
  };

  return botInstance;
}
