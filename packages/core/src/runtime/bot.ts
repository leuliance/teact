import React, { Suspense, useMemo, useReducer } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import { createRoot, type TeactRoot, type OutputNode, type BotContext, type SessionStore, type SessionData, type Middleware, type Adapter, type PlatformApi } from '../renderer';
import { CallbackRegistryCtx, ErrorBoundary, type CallbackMap } from '../renderer';
import { RuntimeContext, type RuntimeContextValue } from './context';
import { ServicesCtx, type ServiceMap } from './services';
import { MemorySessionStore } from './session';
import { compose } from './middleware';
import { RouterProvider, CommitModeCtx, type RouterConfig, type CommitModeRef } from './router';
import type { TeactPlugin } from './plugin';
import type { TeactConfig } from './config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Minimal internal Suspense fallback — a raw host element so core never imports @teactjs/ui. */
const InternalSuspenseFallback = () =>
  React.createElement('tg-message', { text: '⏳ Loading…' });

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

/** Parse a .env file body. Supports comments, `export KEY=…`, quotes and inline `#` comments. */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) !== -1) {
      value = value.slice(1, value.indexOf(quote, 1));
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      // Unquoted: strip an inline comment (" #…").
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadEnvFile(): void {
  if (!HAS_FS) return;
  try {
    const parsed = parseEnv(readFileSync('.env', 'utf-8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
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
// When the dev server re-executes the entry file, stop the previous bot first.

const GLOBAL_KEY = '__teact_bot_instance__';
const SIGNALS_KEY = '__teact_signals_installed__';

async function cleanupPreviousInstance(current: unknown): Promise<void> {
  const prev = (globalThis as any)[GLOBAL_KEY];
  if (prev && prev !== current && typeof prev.stop === 'function') {
    console.log('[teact] Hot-reloading — stopping previous instance…');
    try { await prev.stop(); } catch {}
  }
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
  /** Parse mode for `text` (e.g. `'HTML'`). */
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

/** Context object passed to command handlers defined in `commands`. */
export interface CommandContext {
  args: string[];
  reply: (text: string, options?: ReplyOptions) => Promise<void>;
  chatId: string;
  user: { id: string; username?: string; firstName?: string };
  platform: string;
  /** Platform API (e.g. `api.sendMessage({ chat_id, text })`), if the adapter provides one. */
  api?: PlatformApi;
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
  /** Hide from the platform's command menu (still works when typed). */
  hidden?: boolean;
}

/** Webhook server configuration for production deployments. */
export interface WebhookConfig {
  domain: string;
  port?: number;
  path?: string;
  secretToken?: string;
}

/** Where an error reported to `onError` came from. */
export type BotErrorSource = 'render' | 'handler' | 'command' | 'send' | 'middleware' | 'plugin';

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
  session?: {
    store?: SessionStore;
    /** TTL for the default in-memory store, in ms. */
    ttl?: number;
    /**
     * Derive the session key from an update. Defaults to one session per chat. Use
     * `(ctx) => \`${ctx.chatId}:${ctx.userId}\`` for per-user sessions in groups.
     */
    getKey?: (ctx: BotContext) => string;
  };
  /** Additional middleware — merged with teact.config middleware */
  middleware?: Middleware[];
  /** Additional plugins — merged with teact.config plugins */
  plugins?: TeactPlugin[];
  /** Bot commands (stays in the React/app layer, not in config) */
  commands?: Record<string, CommandDef>;
  /**
   * Central error hook — render crashes, failing click handlers, commands, failed sends.
   * Use it to report to Sentry & co. Defaults to `console.error`.
   */
  onError?: (error: unknown, info: { source: BotErrorSource; ctx?: BotContext }) => void;
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
  threadId?: number;
  lastMessageId?: number;
  commitQueue: Promise<void>;
  commitMode: CommitModeRef;
  /** The runtime (session, botCtx) of the update currently being processed. */
  runtime: { current: RuntimeContextValue };
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

/** Prefix for callback data shortened to fit Telegram's 64-byte limit. */
const ALIAS_PREFIX = '__h:';
const MAX_CALLBACK_BYTES = 64;

/** Safety timeout for awaiting a render commit; see renderForChat for why it's generous. */
const COMMIT_BACKSTOP_MS = 10_000;

/** Telegram's command-name rule; other platforms are at least as permissive. */
const COMMAND_NAME_RE = /^[a-z0-9_]{1,32}$/;

const utf8 = new TextEncoder();

/** Deterministic short hash (FNV-1a, 2×32-bit) — stable across restarts. */
function shortHash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function buildMessageNode(text: string, opts: ReplyOptions = {}): OutputNode {
  const { buttons, replyKeyboard, parseMode } = opts;
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
          callbackData: btn.url ? undefined : btn.route ? `${ROUTE_PREFIX}${btn.route}` : btn.text,
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
  return { type: 'tg-message', props: { text, parseMode }, children };
}

/** Parse `/cmd@bot arg1 arg2` → `{ name, mention, args }` (or null if not a command). */
function parseCommand(text: string | undefined): { name: string; mention?: string; args: string[] } | null {
  if (!text?.startsWith('/')) return null;
  const [head, ...args] = text.trim().slice(1).split(/\s+/);
  if (!head) return null;
  const [name, mention] = head.split('@');
  return { name: name.toLowerCase(), mention, args: args.filter(Boolean) };
}

/**
 * Provides the runtime context and re-renders consumers when the session changes —
 * so `setSession()` called from an effect or async callback updates the UI too.
 */
function RuntimeBridge({ value, current, children }: {
  value: RuntimeContextValue;
  /** The chat's live runtime — click handlers from an earlier render write through it. */
  current: { current: RuntimeContextValue };
  children?: ReactNode;
}) {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const ctxValue = useMemo<RuntimeContextValue>(
    () => ({
      ...value,
      updateSession(patch) {
        // Always write into the CURRENT update's session: a button handler captured this
        // function during the previous render, but runs during the next update.
        current.current.updateSession(patch);
        bump();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, version],
  );
  return React.createElement(RuntimeContext.Provider, { value: ctxValue }, children);
}

// ---- createBot ----

/**
 * Create and configure a Teact bot instance.
 *
 * Provide either a `component` (single-page) or a `router` (multi-page) for the UI.
 * Call `.start()` on the returned object to connect and begin processing updates,
 * or use `.fetch(request)` as a serverless webhook handler.
 *
 * @param options - Bot configuration including adapter, component/router, commands, and plugins.
 * @returns A bot instance with `start()`, `stop()`, `fetch()` and `send()`.
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
  if (!options.adapter) {
    throw new Error('[teact] createBot needs an `adapter`, e.g. `adapter: new TelegramAdapter()` from @teactjs/telegram.');
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

  function reportError(error: unknown, source: BotErrorSource, ctx?: BotContext) {
    if (options.onError) {
      try { options.onError(error, { source, ctx }); return; }
      catch (hookErr) { console.error('[teact] onError hook threw:', hookErr); }
    }
    const where = ctx ? ` (chat ${ctx.chatId})` : '';
    console.error(`[teact] ${source} error${where}:`, error);
  }

  const chatRoots = new Map<string, ChatRoot>();
  // Serializes updates per chat: a chat's next update waits for its previous one to
  // finish rendering + sending. Without this, two rapid messages/callbacks for the same
  // chat interleave and race on the shared ChatRoot (commitSignal, commitMode, handlers).
  const chatLocks = new Map<string, Promise<void>>();
  // Long callback data → short alias, per chat (bounded). Survives root resets.
  const callbackAliases = new Map<string, Map<string, string>>();
  let warnedMemoryStoreOnEdge = false;
  let disposed = false;
  let listenersWired = false;
  let initPromise: Promise<void> | null = null;
  let webhookFn: ((request: Request) => Promise<Response>) | null = null;

  // These are mutable — they get merged with teact.config during initialize()
  let rawCommands: Record<string, CommandDef> = {};
  let plugins: TeactPlugin[] = [];
  let userMiddleware: Middleware[] = [];
  let pluginMiddleware: Middleware[] = [];
  let mergedServices: ServiceMap = {};
  let sessionStore: SessionStore = new MemorySessionStore(options.session?.ttl);
  let loadedConfig: TeactConfig = {};

  const chatKeyOf = (ctx: { platform: string; chatId: string; threadId?: number }) =>
    `${ctx.platform}:${ctx.chatId}${ctx.threadId != null ? `:${ctx.threadId}` : ''}`;
  const sessionKeyOf = (ctx: BotContext) =>
    options.session?.getKey?.(ctx) ?? `${ctx.platform}:${ctx.chatId}`;

  function resetChatRoot(ctx: BotContext) {
    const chatKey = chatKeyOf(ctx);
    const existing = chatRoots.get(chatKey);
    if (existing) {
      existing.root.unmount();
      chatRoots.delete(chatKey);
    }
  }

  /** Replace callback data over the platform limit with a short, stable alias. */
  function shortenCallbackData(chatKey: string, node: OutputNode): void {
    if (node.type === 'tg-button' && typeof node.props.callbackData === 'string') {
      const data: string = node.props.callbackData;
      if (utf8.encode(data).length > MAX_CALLBACK_BYTES) {
        const alias = `${ALIAS_PREFIX}${shortHash(data)}`;
        let map = callbackAliases.get(chatKey);
        if (!map) callbackAliases.set(chatKey, (map = new Map()));
        map.delete(alias);
        map.set(alias, data);
        if (map.size > 1000) map.delete(map.keys().next().value as string);
        node.props = { ...node.props, callbackData: alias };
      }
    }
    for (const child of node.children) shortenCallbackData(chatKey, child);
  }

  function buildCommandContext(botCtx: BotContext, args: string[]): CommandContext {
    return {
      args,
      reply: async (text: string, opts?: ReplyOptions) => {
        await adapter.send(botCtx.chatId, buildMessageNode(text, opts), { threadId: botCtx.threadId });
      },
      chatId: botCtx.chatId,
      user: botCtx.user,
      platform: botCtx.platform,
      api: botCtx.api,
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
    const chatKey = chatKeyOf(botCtx);
    const prev = chatLocks.get(chatKey) ?? Promise.resolve();
    const tail = prev.then(() => processUpdate(botCtx));
    chatLocks.set(chatKey, tail);
    // Prune the lock once settled, unless another update has already queued behind us.
    tail.finally(() => {
      if (chatLocks.get(chatKey) === tail) chatLocks.delete(chatKey);
    });
    return tail;
  }

  async function processUpdate(incoming: BotContext): Promise<void> {
    if (disposed) return;
    const updateStart = Date.now();
    const chatKey = chatKeyOf(incoming);

    // Normalize: infer the update type and expand shortened callback data so middleware,
    // plugins and handlers all see the original value.
    let botCtx: BotContext = {
      ...incoming,
      updateType: incoming.updateType ?? (incoming.callbackData != null ? 'callback_query' : 'message'),
    };
    if (botCtx.callbackData?.startsWith(ALIAS_PREFIX)) {
      const original = callbackAliases.get(chatKey)?.get(botCtx.callbackData);
      if (original) botCtx = { ...botCtx, callbackData: original };
    }

    debugLog('update received', {
      chatId: botCtx.chatId,
      type: botCtx.updateType,
      text: botCtx.text,
      callbackData: botCtx.callbackData,
    });

    try {
      const pipeline = compose([
        ...pluginMiddleware,
        ...userMiddleware,
        async (ctx) => { await routeUpdate(ctx); },
      ]);
      await pipeline(botCtx, async () => {});
      debugLog(`update processed in ${Date.now() - updateStart}ms`);
    } catch (err) {
      reportError(err, 'middleware', botCtx);
    }
  }

  /** Final stage of the pipeline: commands, route buttons, then rendering. */
  async function routeUpdate(botCtx: BotContext): Promise<void> {
    let commandInfo: CommandInfo | undefined;

    if (botCtx.callbackData?.startsWith('__convo:')) {
      console.warn(
        `[teact] Received conversation callback "${botCtx.callbackData}" but no conversationsPlugin handled it.\n` +
        '  → Add conversationsPlugin() to your plugins (createBot({ plugins }) or teact.config.ts).',
      );
      return;
    }

    if (botCtx.updateType === 'callback_query' && botCtx.callbackData?.startsWith(ROUTE_PREFIX)) {
      const routePath = botCtx.callbackData.slice(ROUTE_PREFIX.length);
      resetChatRoot(botCtx);
      commandInfo = { name: '', args: [], initialRoute: routePath };
    } else if (botCtx.updateType === 'message') {
      const cmd = parseCommand(botCtx.text);
      if (cmd) {
        // `/start@OtherBot` in a group is addressed to a different bot — not ours.
        if (cmd.mention && botCtx.botUsername && cmd.mention.toLowerCase() !== botCtx.botUsername.toLowerCase()) {
          debugLog('ignoring command for another bot', cmd);
          return;
        }
        const cmdDef = rawCommands[cmd.name];
        if (cmdDef) {
          resetChatRoot(botCtx);

          if (cmdDef.handler != null) {
            try {
              if (typeof cmdDef.handler === 'string') {
                await adapter.send(botCtx.chatId, buildMessageNode(cmdDef.handler), { threadId: botCtx.threadId });
              } else {
                await cmdDef.handler(buildCommandContext(botCtx, cmd.args));
              }
            } catch (err) {
              reportError(err, 'command', botCtx);
            }
            return;
          }

          let initialRoute: string | undefined;
          if (cmdDef.deepLink && cmd.args.length > 0) {
            try { initialRoute = cmdDef.deepLink(cmd.args); }
            catch (err) { reportError(err, 'command', botCtx); }
          }
          initialRoute ??= cmdDef.route;
          commandInfo = { name: cmd.name, args: cmd.args, initialRoute };
        }
      }
    } else if (botCtx.updateType !== 'callback_query') {
      // Other events (poll answers, edits, payments, membership…) only re-render a chat
      // that already has a live UI — e.g. so useOn('poll_answer') fires. They must never
      // spawn a fresh screen in a chat that didn't ask for one.
      if (!chatRoots.has(chatKeyOf(botCtx))) return;
    }

    await renderForChat(botCtx, commandInfo);
  }

  async function renderForChat(
    botCtx: BotContext,
    commandInfo?: CommandInfo,
  ): Promise<void> {
    const chatKey = chatKeyOf(botCtx);
    const sessionKey = sessionKeyOf(botCtx);
    const session: SessionData = (await sessionStore.get(sessionKey)) ?? {};
    let chatState = chatRoots.get(chatKey);

    // Recover from a previous render error: rebuild a fresh root so the chat isn't
    // permanently stuck showing the error boundary fallback.
    if (chatState?.errored) {
      chatState.root.unmount();
      chatRoots.delete(chatKey);
      chatState = undefined;
    }

    // Track the latest session write so we can await it before returning. On serverless
    // the isolate freezes once the Response resolves, so a fire-and-forget set() to an
    // async store (KV, Redis, DB) would be dropped and the session would never persist.
    let sessionWrite: Promise<unknown> = Promise.resolve();
    const runtimeValue: RuntimeContextValue = {
      botCtx,
      session,
      updateSession(patch) {
        Object.assign(session, patch);
        // Snapshot so later mutations of `session` don't leak into an in-flight write.
        sessionWrite = Promise.resolve(sessionStore.set(sessionKey, { ...session }))
          .catch((err) => reportError(err, 'plugin', botCtx));
      },
      command: commandInfo ? { name: commandInfo.name, args: commandInfo.args } : null,
    };

    if (!chatState) {
      const handlers: CallbackMap = new Map();
      const { chatId, threadId } = botCtx;
      const commitMode: CommitModeRef = { current: 'replace' };

      const root = createRoot((tree: OutputNode) => {
        if (disposed) return;
        const cs = chatRoots.get(chatKey);
        if (!cs || cs.root !== root) return;
        shortenCallbackData(chatKey, tree);

        cs.commitQueue = cs.commitQueue.then(async () => {
          if (disposed) return;
          const mode = cs.commitMode.current;
          cs.commitMode.current = 'replace';
          const send = async () => {
            const msgId = await adapter.send(chatId, tree, { threadId });
            if (msgId) cs.lastMessageId = msgId;
          };

          try {
            switch (mode) {
              case 'dismiss': {
                // Only clears buttons — never turns into a surprise new message.
                if (cs.lastMessageId) await adapter.clearButtons(chatId, cs.lastMessageId);
                break;
              }
              case 'push':
                await send();
                break;
              case 'stack': {
                if (cs.lastMessageId) await adapter.clearButtons(chatId, cs.lastMessageId);
                await send();
                break;
              }
              default: {
                if (cs.lastMessageId && adapter.canEdit(tree, chatId, cs.lastMessageId)) {
                  try {
                    await adapter.edit(chatId, cs.lastMessageId, tree);
                  } catch (err) {
                    // The message may be gone or too old to edit — show the screen anew.
                    debugLog('edit failed, sending instead', { error: (err as Error)?.message });
                    await send();
                  }
                } else {
                  await send();
                }
              }
            }
          } catch (err) {
            if (!disposed) reportError(err, 'send', botCtx);
          }
        });

        // Wake any renderForChat awaiting this commit: the send task is now queued.
        cs.commitSignal?.();
      });

      chatState = {
        root, handlers, chatId, threadId, lastMessageId: undefined,
        commitQueue: Promise.resolve(), commitMode, runtime: { current: runtimeValue },
      };
      chatRoots.set(chatKey, chatState);
    }

    chatState.runtime.current = runtimeValue;

    if (botCtx.updateType === 'message') {
      // A new user message → answer with a new message below it.
      chatState.lastMessageId = undefined;
    } else if (botCtx.updateType === 'callback_query' && !chatState.lastMessageId && botCtx.messageId) {
      // A button on a message we no longer track (route button, restart, error recovery):
      // edit that very message in place instead of posting a new one.
      const id = Number(botCtx.messageId);
      if (Number.isFinite(id) && id > 0) chatState.lastMessageId = id;
    }

    // Dispatch the click BEFORE clearing handlers: the map holds the previous render's
    // handlers, which is what the tapped button was rendered with.
    if (botCtx.updateType === 'callback_query' && botCtx.callbackData) {
      const handler = chatState.handlers.get(botCtx.callbackData);
      if (handler) {
        try {
          // Async handlers are awaited so their work (and state updates) lands within this
          // update — required on serverless. Sync handlers are NOT awaited, so their state
          // updates batch with the render below into a single commit.
          const result = handler();
          if (result && typeof (result as Promise<void>).then === 'function') await result;
        } catch (err) {
          reportError(err, 'handler', botCtx);
        }
      } else {
        debugLog('no handler for callback data', botCtx.callbackData);
      }
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

    const errorChat = chatState.chatId;
    const wrappedElement = React.createElement(
      ErrorBoundary,
      {
        onError: (err: Error) => {
          reportError(err, 'render', { ...botCtx, chatId: errorChat });
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
          RuntimeBridge,
          { value: runtimeValue, current: chatState.runtime },
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
    // wait for onCommit to signal (send task queued), THEN drain the queue for the actual
    // send/edit. Critical on serverless/edge: once bot.fetch() resolves its Response the
    // isolate may freeze, so the send must complete before we return.
    const cs = chatState;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const committed = new Promise<void>((resolve) => {
      cs.commitSignal = resolve;
      // Backstop only: renderForChat always renders a fresh element (new context
      // identities), so the root always commits and commitSignal always fires. This
      // timer just prevents a permanent hang in the pathological no-commit case
      // (e.g. disposed mid-render). It must be long enough never to cut off a real
      // (possibly Suspense-delayed) commit.
      commitTimer = setTimeout(() => {
        debugLog('commit backstop fired — no commit observed', { chatId: botCtx.chatId });
        resolve();
      }, COMMIT_BACKSTOP_MS);
    });
    cs.root.render(element);
    await committed;
    if (commitTimer) clearTimeout(commitTimer);
    cs.commitSignal = undefined;
    // Drain: a commit can enqueue follow-up work (effects that set state synchronously,
    // a click handler's late commit). Keep awaiting until the queue stops growing.
    for (let i = 0; i < 10; i++) {
      const queued = cs.commitQueue;
      await queued;
      await new Promise((r) => setTimeout(r, 0));
      if (cs.commitQueue === queued) break;
    }
    // Ensure any session write triggered by this render (or its onClick handler) is
    // durably persisted before we return — critical on serverless (see above).
    await sessionWrite;
  }

  /** Validate + normalize command names (Telegram rejects the whole menu on one bad entry). */
  function normalizeCommands(input: Record<string, CommandDef>): Record<string, CommandDef> {
    const out: Record<string, CommandDef> = {};
    for (const [rawName, def] of Object.entries(input)) {
      const name = rawName.replace(/^\//, '').toLowerCase();
      if (!COMMAND_NAME_RE.test(name)) {
        console.warn(`[teact] Command "/${rawName}" is invalid — names must be 1–32 chars of a-z, 0-9 or _. Skipping it.`);
        continue;
      }
      if (rawName !== name) {
        console.warn(`[teact] Command "${rawName}" normalized to "/${name}".`);
      }
      out[name] = def;
    }
    return out;
  }

  /**
   * One-time setup shared by start() (polling/webhook server) and fetch() (serverless):
   * load config, merge plugins, connect the adapter, run onStart, wire update handlers.
   * Memoized so serverless cold-starts initialize exactly once — but a failed attempt is
   * NOT cached, so the next request retries instead of failing forever.
   */
  function initialize(opts?: { registerCommands?: boolean }): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // Auto-load teact.config.ts (fs-based; harmlessly returns {} on serverless/edge).
      loadedConfig = await loadTeactConfig();

      plugins = [...(loadedConfig.plugins ?? []), ...(options.plugins ?? [])];
      // Drop duplicate plugins (same name registered in both teact.config.ts and
      // createBot({ plugins })). Otherwise you get two driver instances, doubled
      // Providers, and duplicated onStart/onStop — the classic dual-instance footgun.
      const seenPlugins = new Set<string>();
      plugins = plugins.filter((p) => {
        if (seenPlugins.has(p.name)) {
          console.warn(`[teact] Plugin "${p.name}" registered more than once — ignoring the duplicate.`);
          return false;
        }
        seenPlugins.add(p.name);
        return true;
      });
      pluginMiddleware = plugins.filter(p => p.middleware).map(p => p.middleware!);
      mergedServices = Object.assign({}, ...plugins.map(p => p.services ?? {}));
      userMiddleware = [...(loadedConfig.middleware ?? []), ...(options.middleware ?? [])];

      // Commands: co-located router `command:` entries first, then explicit createBot commands.
      rawCommands = normalizeCommands({ ...(options.router?.commands ?? {}), ...(options.commands ?? {}) });

      if (options.session?.store) sessionStore = options.session.store;
      else if (loadedConfig.session?.store) sessionStore = loadedConfig.session.store;
      else if (loadedConfig.session?.ttl && !options.session?.ttl) sessionStore = new MemorySessionStore(loadedConfig.session.ttl);

      await adapter.connect({ token: resolvedToken });

      for (const plugin of plugins) {
        if (plugin.onStart) {
          try { await plugin.onStart(adapter); }
          catch (err) { reportError(err, 'plugin'); console.error(`[teact] Plugin "${plugin.name}" onStart failed.`); }
        }
      }

      // Register the platform command menu (skipped on serverless by default — set it
      // once at deploy time instead of on every cold start).
      if (opts?.registerCommands !== false) {
        const botCommands = Object.entries(rawCommands)
          .filter(([, def]) => !def.hidden)
          .map(([name, def]) => ({ command: name, description: (def.description || name).slice(0, 256) }));
        if (botCommands.length > 0) {
          try {
            await adapter.setCommands(botCommands);
            console.log(`[teact] Registered ${botCommands.length} command(s)`);
          } catch (err) {
            console.warn('[teact] Could not set bot commands:', err);
          }
        }
      }

      if (!listenersWired) {
        listenersWired = true;
        adapter.on('message', (ctx: BotContext) => handleUpdate(ctx));
        adapter.on('callback_query', (ctx: BotContext) => handleUpdate(ctx));
        adapter.on('event', (ctx: BotContext) => handleUpdate(ctx));
      }
    })();
    initPromise.catch(() => { initPromise = null; });
    return initPromise;
  }

  /**
   * Render a React element once (outside any chat's live UI) into an output tree.
   * Used by `bot.send()` for notifications/broadcasts.
   */
  async function renderStatic(element: React.ReactElement, chatId: string): Promise<OutputNode | null> {
    let output: OutputNode | null = null;
    let done!: () => void;
    const committed = new Promise<void>((r) => { done = r; });
    const root = createRoot((tree) => { output = tree; done(); });
    const platform = adapter.name;
    const botCtx: BotContext = {
      chatId, userId: chatId, platform, updateType: 'broadcast',
      user: { id: chatId, platform }, raw: null, api: adapter.api,
    };
    root.render(
      React.createElement(ServicesCtx.Provider, { value: mergedServices },
        React.createElement(CallbackRegistryCtx.Provider, { value: { handlers: new Map() } },
          React.createElement(RuntimeContext.Provider, {
            value: { botCtx, session: {}, updateSession() {}, command: null },
          }, element))),
    );
    const timer = setTimeout(done, COMMIT_BACKSTOP_MS);
    await committed;
    clearTimeout(timer);
    root.unmount();
    return output;
  }

  const botInstance = {
    /** The adapter this bot runs on. */
    adapter,

    /** Platform API (when the adapter exposes one), e.g. `bot.api.sendMessage({ chat_id, text })`. */
    get api(): PlatformApi | undefined {
      return adapter.api;
    },

    async start() {
      // Stop any previous instance (HMR / dev-server re-run).
      await cleanupPreviousInstance(botInstance);
      (globalThis as any)[GLOBAL_KEY] = botInstance;
      disposed = false;

      try {
        await initialize({ registerCommands: true });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[teact] Failed to start: ${msg}`);
        if (/token/i.test(msg) || (err as any)?.errorCode === 401) {
          console.error('[teact] → Get a token from @BotFather and put TELEGRAM_BOT_TOKEN=... in your .env file.');
        }
        throw err;
      }

      const mode = options.mode ?? loadedConfig.mode ?? 'polling';
      const webhook = options.webhook ?? loadedConfig.webhook;
      if (mode === 'webhook' && !webhook) {
        console.warn('[teact] mode is "webhook" but no webhook config was given — falling back to polling.');
      }
      if (mode === 'webhook' && webhook) {
        await adapter.listen({ webhook });
      } else {
        await adapter.listen({ polling: true });
      }

      // Graceful shutdown — installed once per process; always stops the current instance.
      if (typeof process !== 'undefined' && typeof process.once === 'function' && !(globalThis as any)[SIGNALS_KEY]) {
        (globalThis as any)[SIGNALS_KEY] = true;
        let stopping = false;
        const shutdown = async () => {
          if (stopping) return;
          stopping = true;
          console.log('\n[teact] Shutting down…');
          try { await (globalThis as any)[GLOBAL_KEY]?.stop(); } finally { process.exit(0); }
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
      }

      console.log(`[teact] Bot started (${mode === 'webhook' && webhook ? 'webhook' : 'polling'})${debugMode ? ' [debug mode]' : ''}`);
      if (debugMode) {
        console.log('[teact:debug] Config:', {
          mode,
          commands: Object.keys(rawCommands),
          plugins: plugins.map(p => p.name),
          middleware: userMiddleware.length + pluginMiddleware.length,
        });
      }
    },

    async stop() {
      if (disposed) return;
      // Let in-flight updates finish (bounded), so we don't cut off a half-sent reply.
      await Promise.race([
        Promise.allSettled([...chatLocks.values()]),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
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

      try { await adapter.disconnect(); } catch (err) { console.error('[teact] Adapter disconnect failed:', err); }
      if ((globalThis as any)[GLOBAL_KEY] === botInstance) (globalThis as any)[GLOBAL_KEY] = undefined;
      console.log('[teact] Bot stopped');
    },

    /**
     * Serverless / edge webhook entry: `(request) => Response`. Initializes the bot
     * once (lazily) and processes a single update per request — no polling, no
     * long-running server. Works on Cloudflare Workers, Vercel/Deno Edge, Bun.serve,
     * Netlify, etc.
     *
     * @example Cloudflare Worker (src/worker.ts)
     * export default {
     *   fetch: (request: Request, env: Env) =>
     *     bot.fetch(request, { token: env.TELEGRAM_BOT_TOKEN, secretToken: env.WEBHOOK_SECRET }),
     * };
     */
    async fetch(request: Request, opts?: { token?: string; secretToken?: string }): Promise<Response> {
      if (opts?.token) resolvedToken = opts.token;
      try {
        await initialize({ registerCommands: false });
      } catch (err) {
        console.error('[teact] Initialization failed:', err);
        // 500 → Telegram retries later, by which time a transient failure may have cleared.
        return new Response('Bot initialization failed', { status: 500 });
      }
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
     * Proactively send a message to a chat — notifications, reminders, broadcasts.
     * Accepts plain text or a JSX element (e.g. `<Message>` with `route` / `url` buttons).
     * `onClick` handlers in such messages aren't wired (there's no live UI behind them);
     * use `route` buttons to open a screen instead.
     *
     * @example
     * await bot.send(chatId, 'Your order shipped! 📦');
     * await bot.send(chatId, <Message text="New reply"><InlineKeyboard><Button text="Open" route="/inbox" /></InlineKeyboard></Message>);
     */
    async send(chatId: string | number, content: string | React.ReactElement, opts?: { threadId?: number }): Promise<number | undefined> {
      await initialize({ registerCommands: false });
      const id = String(chatId);
      const tree = typeof content === 'string' ? buildMessageNode(content) : await renderStatic(content, id);
      if (!tree) return undefined;
      shortenCallbackData(`${adapter.name}:${id}`, tree);
      return adapter.send(id, tree, opts);
    },

    _chatRoots: chatRoots,
    // Getter so callers see the store actually in use after initialize() may have
    // replaced the default with one from createBot({ session }) or teact.config.ts.
    get _sessionStore() { return sessionStore; },
  };

  return botInstance;
}

/** A bot instance returned by {@link createBot}. */
export type TeactBot = ReturnType<typeof createBot>;
