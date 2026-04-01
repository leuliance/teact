import React, { Suspense } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import { createRoot, type TeactRoot, type OutputNode, type BotContext, type SessionStore, type Middleware } from '@teact/renderer';
import { TelegramAdapter, serializeOutput } from '@teact/telegram';
import { CallbackRegistryCtx, ErrorBoundary, SuspenseFallback, type CallbackMap } from '@teact/react';
import { RuntimeContext, type RuntimeContextValue } from './context';
import { MemorySessionStore } from './session';
import { compose } from './middleware';
import { RouterProvider, CommitModeCtx, type RouterConfig, type NavigateMode, type CommitModeRef } from './router';
import type { TeactPlugin } from './plugin';
import type { TeactConfig } from './config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- .env auto-loader ----

function loadEnvFile(): void {
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
  adapter: TelegramAdapter;
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
}

interface CommandInfo {
  name: string;
  args: string[];
  initialRoute?: string;
}

const ROUTE_PREFIX = '__route:';

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
  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[teact] No bot token found. Add TELEGRAM_BOT_TOKEN to your .env file.');
    process.exit(1);
  }

  function debugLog(...args: any[]) {
    if (debugMode) console.log(`[teact:debug ${new Date().toISOString()}]`, ...args);
  }

  const chatRoots = new Map<string, ChatRoot>();
  let disposed = false;

  // These are mutable — they get merged with teact.config in start()
  let rawCommands: Record<string, CommandDef> = options.commands ?? {};
  let plugins: TeactPlugin[] = [];
  let userMiddleware: Middleware[] = [];
  let pluginMiddleware: Middleware[] = [];
  let sessionStore: SessionStore = new MemorySessionStore(options.session?.ttl);

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
                if (cs.lastMessageId) {
                  const payload = serializeOutput(tree);
                  if (payload.method === 'sendMessage' && !payload.replyKeyboard && !payload.removeKeyboard) {
                    await adapter.edit(Number(chatId), cs.lastMessageId, tree);
                  } else {
                    const msgId = await adapter.send(Number(chatId), tree);
                    if (msgId) cs.lastMessageId = msgId;
                  }
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
        onError: (err: Error) => console.error(`[teact] Render error in chat ${chatState.chatId}:`, err),
      },
      React.createElement(
        Suspense,
        { fallback: React.createElement(SuspenseFallback, null) },
        rootElement,
      ),
    );

    const element = React.createElement(
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
    );

    debugLog('rendering', { chatId: botCtx.chatId, hasRouter: !!options.router, plugins: plugins.length });
    chatState.root.render(element);
  }

  const botInstance = {
    async start() {
      // 0. Stop any previous instance (HMR / vite-node --watch)
      await cleanupPreviousInstance();
      registerGlobalInstance(botInstance);

      // 1. Auto-load teact.config.ts (like next.config.js — no import needed)
      const fileConfig = await loadTeactConfig();

      // Merge: config plugins first, then createBot plugins (app can add more)
      plugins = [...(fileConfig.plugins ?? []), ...(options.plugins ?? [])];
      pluginMiddleware = plugins.filter(p => p.middleware).map(p => p.middleware!);
      userMiddleware = [...(fileConfig.middleware ?? []), ...(options.middleware ?? [])];

      // Commands come from createBot only — config is infrastructure, not app logic
      rawCommands = options.commands ?? {};

      // Session: createBot overrides config
      if (options.session?.store) {
        sessionStore = options.session.store;
      } else if (fileConfig.session?.store) {
        sessionStore = fileConfig.session.store;
      }

      // 2. Create the Grammy bot
      await adapter.connect({ token });

      // 2. Run plugin onStart hooks
      for (const plugin of plugins) {
        if (plugin.onStart) {
          try {
            await plugin.onStart(adapter);
          } catch (err) {
            console.error(`[teact] Plugin "${plugin.name}" onStart failed:`, err);
          }
        }
      }

      // 3. Register commands
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

      // 4. Register handlers and start
      adapter.on('message', (ctx: BotContext) => handleUpdate(ctx));
      adapter.on('callback_query', (ctx: BotContext) => handleUpdate(ctx));

      const mode = options.mode ?? fileConfig.mode ?? 'polling';
      const webhook = options.webhook ?? fileConfig.webhook;
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

    _chatRoots: chatRoots,
    _sessionStore: sessionStore,
  };

  return botInstance;
}
