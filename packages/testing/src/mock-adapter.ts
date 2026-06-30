import type { Adapter, BotContext, OutputNode } from '@teactjs/core';

type EventHandler = (ctx: BotContext) => void;

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

  private emit(event: string, ctx: BotContext): void {
    for (const handler of this.listeners.get(event) ?? []) handler(ctx);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async send(chatId: string | number, output: OutputNode): Promise<number> {
    const id = this.msgIdCounter++;
    this.sent.push({ chatId, output, timestamp: Date.now() });
    return id;
  }

  async edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void> {
    this.edited.push({ chatId, messageId, output, timestamp: Date.now() });
  }

  /** A tg-message with no reply-keyboard mutation can be applied as an edit. */
  canEdit(output: OutputNode): boolean {
    if (output.type !== 'tg-message') return false;
    return !output.children.some(
      (c) => c.type === 'tg-reply-keyboard' || c.type === 'tg-reply-keyboard-remove',
    );
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

  /** Simulate an incoming text message. Each gets a unique messageId, like Telegram. */
  simulateMessage(chatId: string, userId: string, text: string): void {
    this.emit('message', makeBotCtx({ chatId, userId, text, messageId: String(this.inMsgId++) }));
  }

  /** Simulate a callback query (button press). */
  simulateCallback(chatId: string, userId: string, data: string, messageId?: string): void {
    this.emit('callback_query', makeBotCtx({ chatId, userId, callbackData: data, messageId: messageId ?? String(this.inMsgId++) }));
  }

  reset(): void {
    this.sent = [];
    this.edited = [];
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
