import type { Adapter, BotContext, OutputNode } from '@teactjs/core';

type EventHandler = (ctx: BotContext) => void | Promise<void>;

export interface SentMessage {
  chatId: string | number;
  output: OutputNode;
  timestamp: number;
}

export interface EditedMessage {
  chatId: string | number;
  messageId: number;
  output: OutputNode;
  timestamp: number;
}

/**
 * Mock adapter that records sent/edited messages and lets tests
 * simulate incoming messages and callback queries.
 */
export class MockAdapter implements Adapter {
  readonly name = 'mock';
  private listeners = new Map<string, Set<EventHandler>>();
  private msgIdCounter = 1;
  private inMsgId = 100;

  sent: SentMessage[] = [];
  edited: EditedMessage[] = [];
  cleared: { chatId: string | number; messageId: number }[] = [];
  commands: { command: string; description: string }[] = [];
  connected = false;

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

  private lastType = new Map<string | number, string>();

  async send(chatId: string | number, output: OutputNode): Promise<number> {
    const id = this.msgIdCounter++;
    this.sent.push({ chatId, output, timestamp: Date.now() });
    this.lastType.set(chatId, output.type);
    return id;
  }

  async edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void> {
    this.edited.push({ chatId, messageId, output, timestamp: Date.now() });
    this.lastType.set(chatId, output.type);
  }

  /**
   * A tg-message with no reply-keyboard mutation can be applied as an edit — but only if
   * the chat's last message was also a plain message (mirrors the real adapter's guard
   * against editing text onto a media message).
   */
  canEdit(output: OutputNode, chatId?: string | number): boolean {
    if (output.type !== 'tg-message') return false;
    if (output.children.some(
      (c) => c.type === 'tg-reply-keyboard' || c.type === 'tg-reply-keyboard-remove',
    )) return false;
    if (chatId != null && this.lastType.has(chatId) && this.lastType.get(chatId) !== 'tg-message') {
      return false;
    }
    return true;
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
      if (body.callbackData) {
        await this.emit('callback_query', makeBotCtx({ chatId: '1', userId: '1', callbackData: body.callbackData, messageId: String(this.inMsgId++) }));
      } else if (body.text) {
        await this.emit('message', makeBotCtx({ chatId: '1', userId: '1', text: body.text, messageId: String(this.inMsgId++) }));
      }
      return new Response('ok', { status: 200 });
    };
  }

  /** Simulate an incoming text message. Each gets a unique messageId, like Telegram. */
  simulateMessage(chatId: string, userId: string, text: string): Promise<void> {
    return this.emit('message', makeBotCtx({ chatId, userId, text, messageId: String(this.inMsgId++) }));
  }

  /** Simulate a callback query (button press). */
  simulateCallback(chatId: string, userId: string, data: string, messageId?: string): Promise<void> {
    return this.emit('callback_query', makeBotCtx({ chatId, userId, callbackData: data, messageId: messageId ?? String(this.inMsgId++) }));
  }

  reset(): void {
    this.sent = [];
    this.edited = [];
    this.lastType.clear();
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

function makeBotCtx(overrides: Partial<BotContext> & { chatId: string; userId: string }): BotContext {
  return {
    platform: 'mock',
    user: { id: overrides.userId, firstName: 'Test', platform: 'mock' },
    raw: {},
    ...overrides,
  };
}
