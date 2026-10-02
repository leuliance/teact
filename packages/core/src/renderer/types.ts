/** Serialized output tree that adapters consume to send platform messages. */
export interface OutputNode {
  type: string;
  props: Record<string, any>;
  children: OutputNode[];
}

export interface User {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBot?: boolean;
  platform: string;
}

/**
 * Framework-agnostic handle to the platform's HTTP API.
 *
 * `call(method, params)` invokes any platform method with its native (snake_case for
 * Telegram) parameters. Adapters may also expose each method as a property — the
 * Telegram adapter does, so `api.sendMessage({ chat_id, text })` works too.
 */
export interface PlatformApi {
  call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  [method: string]: any;
}

export interface BotContext {
  chatId: string;
  userId: string;
  user: User;
  platform: string;
  messageId?: string;
  text?: string;
  callbackData?: string;
  /**
   * The kind of update that produced this context, e.g. `'message'`, `'callback_query'`,
   * `'edited_message'`, `'poll_answer'`. Defaults to `'message'` / `'callback_query'`
   * (inferred from `callbackData`) when an adapter doesn't set it.
   */
  updateType?: string;
  /** The bot's own username (e.g. "my_bot"), available after connection. */
  botUsername?: string;
  /** Message thread (forum topic) the update belongs to, if any. */
  threadId?: number;
  /**
   * The raw platform update, exactly as the platform delivered it. For Telegram this is
   * the Bot API `Update` object (snake_case: `raw.message`, `raw.callback_query`, …) —
   * identical no matter which driver (fetch, grammY, GramIO) received it.
   */
  raw: any;
  /** Platform API caller for advanced calls — see {@link PlatformApi}. */
  api?: PlatformApi;
  /** The underlying framework's own context (grammY `Context`, GramIO context), if any. */
  native?: unknown;
}

export interface SessionData {
  [key: string]: any;
}

export interface SessionStore {
  get(key: string): Promise<SessionData | null>;
  set(key: string, data: SessionData): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Middleware runs on every update before the component tree renders.
 *
 * `next()` is called automatically if a middleware completes without calling it, so loggers
 * and analytics never block the chain by accident. To deliberately stop processing (rate
 * limits, bans, an update fully handled by a plugin), return `false`.
 */
export type Middleware = (ctx: BotContext, next: () => Promise<void>) => Promise<void | false> | void | false;

/** Webhook server configuration (platform-neutral). */
export interface WebhookConfig {
  domain: string;
  port?: number;
  path?: string;
  secretToken?: string;
}

/** Options for {@link Adapter.listen}. */
export interface ListenOptions {
  polling?: boolean;
  webhook?: WebhookConfig;
}

/**
 * Platform-neutral adapter contract.
 *
 * A platform package (e.g. `@teactjs/telegram`) implements this so the bot
 * engine in `@teactjs/core` never depends on a specific platform or driver.
 * This is the seam that makes grammY / gram.io / telegraf — and eventually
 * WhatsApp / Discord — interchangeable.
 */
export interface Adapter {
  readonly name: string;
  /**
   * Connect to the platform (create the underlying client). Does not start receiving.
   * `token` is whatever `createBot` resolved (option, `bot.fetch(req, { token })`, or env);
   * adapters that carry their own credentials may ignore it.
   */
  connect(config: { token?: string }): Promise<void>;
  /**
   * Subscribe to a normalized event: `'message'` (new user message), `'callback_query'`
   * (button tap), `'event'` (any other chat-bound update — polls, edits, payments, …).
   */
  on(event: string, handler: (ctx: BotContext) => void | Promise<void>): void;
  /** Send a rendered output tree; resolves to the platform message id (if any). */
  send(chatId: string | number, output: OutputNode, opts?: { threadId?: number }): Promise<number | undefined>;
  /** Edit an existing message in place from a new output tree. */
  edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void>;
  /**
   * Whether `output` can be applied as an in-place edit of message `messageId`.
   * `chatId`/`messageId` let the adapter reject edits the platform can't do in place
   * (e.g. turning a media message into text).
   */
  canEdit(output: OutputNode, chatId?: string | number, messageId?: number): boolean;
  /** Remove inline keyboard buttons from a message. */
  clearButtons(chatId: string | number, messageId: number): Promise<void>;
  /** Register the platform's command menu. */
  setCommands(commands: { command: string; description: string }[]): Promise<void>;
  /** Start receiving updates (polling or webhook). */
  listen(opts?: ListenOptions): Promise<void>;
  /** Stop receiving and clean up. */
  disconnect(): Promise<void>;
  /**
   * Optional: a web-standard webhook handler `(Request) => Promise<Response>` for
   * serverless/edge deploys (Cloudflare Workers, Vercel/Deno Edge, Bun, Node).
   * Adapters that implement it enable `bot.fetch(request)`.
   */
  webhookCallback?(opts?: { secretToken?: string }): (request: Request) => Promise<Response>;
  /** Optional: framework-agnostic API caller (exposed as `bot.api`). */
  readonly api?: PlatformApi;
}
