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

export interface BotContext {
  chatId: string;
  userId: string;
  user: User;
  platform: string;
  messageId?: string;
  text?: string;
  callbackData?: string;
  /** The bot's own username (e.g. "my_bot"), available after connection. */
  botUsername?: string;
  raw: any;
}

export interface SessionData {
  [key: string]: any;
}

export interface SessionStore {
  get(key: string): Promise<SessionData | null>;
  set(key: string, data: SessionData): Promise<void>;
  delete(key: string): Promise<void>;
}

export type Middleware = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;

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
  /** Connect to the platform (create the underlying client). Does not start receiving. */
  connect(config: { token: string }): Promise<void>;
  /** Subscribe to a normalized event (e.g. `'message'`, `'callback_query'`). */
  on(event: string, handler: (ctx: BotContext) => void | Promise<void>): void;
  /** Send a rendered output tree; resolves to the platform message id (if any). */
  send(chatId: string | number, output: OutputNode): Promise<number | undefined>;
  /** Edit an existing message in place from a new output tree. */
  edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void>;
  /** Whether `output` can be applied as an in-place edit of a text message. */
  canEdit(output: OutputNode): boolean;
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
}
