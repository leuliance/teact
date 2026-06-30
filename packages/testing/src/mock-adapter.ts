import type { BotContext, OutputNode } from '@teactjs/core';

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
export class MockAdapter {
  readonly name = 'mock';
  private listeners = new Map<string, Set<EventHandler>>();
  private msgIdCounter = 1;

  sent: SentMessage[] = [];
  edited: EditedMessage[] = [];
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

  /** Simulate an incoming text message. */
  simulateMessage(chatId: string, userId: string, text: string): void {
    this.emit('message', makeBotCtx({ chatId, userId, text }));
  }

  /** Simulate a callback query (button press). */
  simulateCallback(chatId: string, userId: string, data: string, messageId?: string): void {
    this.emit('callback_query', makeBotCtx({ chatId, userId, callbackData: data, messageId }));
  }

  reset(): void {
    this.sent = [];
    this.edited = [];
    this.msgIdCounter = 1;
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
