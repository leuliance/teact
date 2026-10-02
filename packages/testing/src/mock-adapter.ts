import type { Adapter, BotContext, OutputNode, PlatformApi } from '@teactjs/core';

type EventHandler = (ctx: BotContext) => void | Promise<void>;

export interface SentMessage {
  chatId: string | number;
  messageId: number;
  output: OutputNode;
  threadId?: number;
  timestamp: number;
}

export interface EditedMessage {
  chatId: string | number;
  messageId: number;
  output: OutputNode;
  timestamp: number;
}

/** A platform API call recorded by the mock (`bot.api.*`, hooks, conversations). */
export interface ApiCall {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Mock adapter that records sent/edited messages and API calls, and lets tests
 * simulate incoming messages, button taps and other events.
 */
export class MockAdapter implements Adapter {
  readonly name = 'mock';
  private listeners = new Map<string, Set<EventHandler>>();
  private msgIdCounter = 1;
  private inMsgId = 100;
  private updateId = 1;
  private lastType = new Map<string, string>();
  private lastSentId = new Map<string, number>();

  sent: SentMessage[] = [];
  edited: EditedMessage[] = [];
  cleared: { chatId: string | number; messageId: number }[] = [];
  commands: { command: string; description: string }[] = [];
  /** Every call made through the mock platform API. */
  apiCalls: ApiCall[] = [];
  /** Override to stub API results: `(method, params) => result`. */
  apiHandler: (method: string, params: Record<string, unknown>) => unknown = (method) =>
    method.startsWith('send') ? { message_id: this.msgIdCounter++ } : true;
  connected = false;

  /** Platform API double: records calls into `apiCalls`. */
  readonly api: PlatformApi = new Proxy({} as PlatformApi, {
    get: (_t, prop) => {
      if (prop === 'then' || typeof prop !== 'string') return undefined;
      const call = async (method: string, params: Record<string, unknown> = {}) => {
        this.apiCalls.push({ method, params });
        return this.apiHandler(method, params);
      };
      return prop === 'call' ? call : (params?: Record<string, unknown>) => call(prop, params);
    },
  });

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  // Await handlers, exactly like the real TelegramAdapter — so bot.fetch()/webhookCallback
  // don't resolve until handleUpdate → renderForChat (and its send) have completed. This
  // faithfully models the serverless isolate-freeze constraint.
  private async emit(event: string, ctx: BotContext): Promise<void> {
    for (const handler of this.listeners.get(event) ?? []) await handler(ctx);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async send(chatId: string | number, output: OutputNode, opts: { threadId?: number } = {}): Promise<number> {
    const messageId = this.msgIdCounter++;
    this.sent.push({ chatId, messageId, output, threadId: opts.threadId, timestamp: Date.now() });
    this.lastType.set(`${chatId}:${messageId}`, output.type);
    this.lastSentId.set(String(chatId), messageId);
    return messageId;
  }

  async edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void> {
    this.edited.push({ chatId, messageId, output, timestamp: Date.now() });
    this.lastType.set(`${chatId}:${messageId}`, output.type);
  }

  /**
   * A tg-message with no reply-keyboard mutation can be applied as an edit — but only if
   * the target message was also a plain message (mirrors the real adapter's guard against
   * editing text onto a media message).
   */
  canEdit(output: OutputNode, chatId?: string | number, messageId?: number): boolean {
    if (output.type !== 'tg-message') return false;
    if (output.children.some(
      (c) => c.type === 'tg-reply-keyboard' || c.type === 'tg-reply-keyboard-remove',
    )) return false;
    const prev = chatId != null && messageId != null ? this.lastType.get(`${chatId}:${messageId}`) : undefined;
    return prev === undefined || prev === 'tg-message';
  }

  async clearButtons(chatId: string | number, messageId: number): Promise<void> {
    this.cleared.push({ chatId, messageId });
  }

  async setCommands(commands: { command: string; description: string }[]): Promise<void> {
    this.commands = commands;
  }

  async listen(): Promise<void> {
    // no-op: tests drive updates via simulateMessage / simulateCallback
  }

  /**
   * Web-standard webhook handler for testing `bot.fetch()`. Accepts a JSON body of
   * `{ text }` or `{ callbackData }` and dispatches it as an update.
   */
  webhookCallback(_opts: { secretToken?: string } = {}): (request: Request) => Promise<Response> {
    return async (request: Request) => {
      const body = await request.json().catch(() => ({})) as { text?: string; callbackData?: string };
      if (body.callbackData) await this.simulateCallback('1', '1', body.callbackData);
      else if (body.text) await this.simulateMessage('1', '1', body.text);
      return new Response('ok', { status: 200 });
    };
  }

  private makeCtx(overrides: Partial<BotContext> & { chatId: string; userId: string }): BotContext {
    return {
      platform: 'mock',
      user: { id: overrides.userId, firstName: 'Test', platform: 'mock' },
      api: this.api,
      raw: { update_id: this.updateId++ },
      ...overrides,
    };
  }

  /** Simulate an incoming text message. Each gets a unique messageId, like Telegram. */
  simulateMessage(chatId: string, userId: string, text: string, extra: Partial<BotContext> = {}): Promise<void> {
    const messageId = this.inMsgId++;
    const ctx = this.makeCtx({
      chatId, userId, text, messageId: String(messageId), updateType: 'message',
      raw: { update_id: this.updateId++, message: { message_id: messageId, chat: { id: Number(chatId) || chatId }, from: { id: Number(userId) || userId }, text } },
      ...extra,
    });
    return this.emit('message', ctx);
  }

  /**
   * Simulate a callback query (button press). `messageId` defaults to the last message the
   * bot sent to this chat — the message a user would realistically be tapping.
   */
  simulateCallback(chatId: string, userId: string, data: string, messageId?: string, extra: Partial<BotContext> = {}): Promise<void> {
    const mid = messageId ?? String(this.lastSentId.get(chatId) ?? this.inMsgId++);
    const ctx = this.makeCtx({
      chatId, userId, callbackData: data, messageId: mid, updateType: 'callback_query',
      raw: { update_id: this.updateId++, callback_query: { id: `cb${this.updateId}`, data, message: { message_id: Number(mid), chat: { id: Number(chatId) || chatId } } } },
      ...extra,
    });
    return this.emit('callback_query', ctx);
  }

  /**
   * Simulate any other update (poll answer, edited message, payment…). `raw` is the
   * platform update, e.g. `{ poll_answer: {...} }`.
   */
  simulateEvent(chatId: string, userId: string, updateType: string, raw: Record<string, unknown> = {}): Promise<void> {
    const ctx = this.makeCtx({ chatId, userId, updateType, raw: { update_id: this.updateId++, ...raw } });
    return this.emit('event', ctx);
  }

  reset(): void {
    this.sent = [];
    this.edited = [];
    this.cleared = [];
    this.apiCalls = [];
    this.lastType.clear();
    this.lastSentId.clear();
    this.msgIdCounter = 1;
    this.inMsgId = 100;
  }

  getLastSent(): SentMessage | undefined {
    return this.sent.at(-1);
  }

  getLastEdited(): EditedMessage | undefined {
    return this.edited.at(-1);
  }
}
