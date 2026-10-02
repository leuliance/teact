import { createBot, type CreateBotOptions, type OutputNode, type TeactBot } from '@teactjs/core';
import { MockAdapter, type ApiCall } from './mock-adapter';

/** A button as the user sees it. */
export interface TestButton {
  text: string;
  /** Callback data (inline buttons) — `undefined` for URL / web-app buttons. */
  data?: string;
  url?: string;
}

/** A message as the user sees it — the latest content after edits. */
export interface TestMessage {
  id: number;
  chatId: string;
  /** Visible text (message text or caption), formatting stripped. */
  text: string;
  /** The root host element type, e.g. `'tg-message'`, `'tg-photo'`. */
  type: string;
  /** Inline keyboard rows. */
  buttons: TestButton[][];
  /** Reply-keyboard rows (button labels). */
  replyKeyboard: string[][];
  /** Whether this message was edited after being sent. */
  edited: boolean;
  /** The raw output tree, for custom assertions. */
  output: OutputNode;
}

export interface TestBotOptions extends Omit<CreateBotOptions, 'adapter' | 'token'> {
  /** Chat the simulated user talks in. @default '1' */
  chatId?: string;
  /** The simulated user's id. @default '1' */
  userId?: string;
}

export interface TestBot {
  /** The underlying bot (for `bot.send()`, `_sessionStore`, …). */
  bot: TeactBot;
  /** The mock adapter, for low-level assertions. */
  adapter: MockAdapter;
  /** Send a text message (or `/command`) as the user and wait for the bot's response. */
  send(text: string): Promise<TestMessage | undefined>;
  /**
   * Tap an inline button by its label (exact match, or a RegExp) on the most recent message
   * that has it. Throws a helpful error listing the visible buttons when not found.
   */
  click(label: string | RegExp): Promise<TestMessage | undefined>;
  /** Simulate any other update, e.g. `event('poll_answer', { poll_answer: {...} })`. */
  event(updateType: string, raw?: Record<string, unknown>): Promise<void>;
  /** All messages in the chat, oldest first, with their latest content. */
  readonly messages: TestMessage[];
  /** The most recently sent or edited message. */
  readonly lastMessage: TestMessage | undefined;
  /** Every platform API call made so far (media hooks, invoices, conversations…). */
  readonly apiCalls: ApiCall[];
  /** Stop the bot (unmount roots, run plugin onStop). */
  stop(): Promise<void>;
}

function collectText(node: OutputNode): string {
  if (node.type === '#text') return String(node.props.value ?? '');
  if (node.type === 'tg-keyboard' || node.type === 'tg-reply-keyboard' || node.type === 'tg-notification') return '';
  let text = '';
  if (typeof node.props.text === 'string' && !node.type.startsWith('tg-button') && node.type !== 'tg-reply-button') text += node.props.text;
  if (typeof node.props.caption === 'string') text += node.props.caption;
  for (const child of node.children) text += collectText(child);
  return text;
}

function collectButtons(node: OutputNode, rows: TestButton[][] = []): TestButton[][] {
  if (node.type === 'tg-button-row') {
    const row = node.children
      .filter((c) => c.type === 'tg-button')
      .map((c) => ({ text: c.props.text, data: c.props.callbackData, url: c.props.url }));
    if (row.length) rows.push(row);
    return rows;
  }
  if (node.type === 'tg-button') {
    rows.push([{ text: node.props.text, data: node.props.callbackData, url: node.props.url }]);
    return rows;
  }
  for (const child of node.children) collectButtons(child, rows);
  return rows;
}

function collectReplyKeyboard(node: OutputNode): string[][] {
  if (node.type === 'tg-reply-keyboard') {
    return node.children.map((row) =>
      row.type === 'tg-reply-row' ? row.children.map((b) => b.props.text) : [row.props.text],
    );
  }
  for (const child of node.children) {
    const rows = collectReplyKeyboard(child);
    if (rows.length) return rows;
  }
  return [];
}

/** Strip the visual variant prefixes `<Button variant>` adds, so tests can click by label. */
function labelMatches(text: string, label: string | RegExp): boolean {
  if (label instanceof RegExp) return label.test(text);
  return text === label || text.replace(/^(▸ |✕ |◦ )/, '') === label;
}

/**
 * Spin up a bot against an in-memory mock platform and drive it like a user would.
 *
 * @example
 * const t = await createTestBot({ component: Counter });
 * await t.send('/start');
 * expect(t.lastMessage?.text).toBe('Count: 0');
 * await t.click('+1');
 * expect(t.lastMessage?.text).toBe('Count: 1');
 */
export async function createTestBot(options: TestBotOptions): Promise<TestBot> {
  const { chatId = '1', userId = '1', ...botOptions } = options;
  const adapter = new MockAdapter();
  const bot = createBot({ ...botOptions, adapter, token: 'test-token' });
  // Initialize without starting polling or touching process signals.
  await bot.fetch(new Request('http://test/', { method: 'POST', body: '{}' }));

  const messages = (): TestMessage[] => {
    const byId = new Map<number, TestMessage>();
    for (const s of adapter.sent) {
      if (String(s.chatId) !== chatId) continue;
      byId.set(s.messageId, toMessage(s.messageId, s.output, false));
    }
    for (const e of adapter.edited) {
      if (String(e.chatId) !== chatId) continue;
      byId.set(e.messageId, toMessage(e.messageId, e.output, true));
    }
    return [...byId.values()].sort((a, b) => a.id - b.id);
  };

  const toMessage = (id: number, output: OutputNode, edited: boolean): TestMessage => ({
    id,
    chatId,
    text: collectText(output).trim(),
    type: output.type,
    buttons: collectButtons(output),
    replyKeyboard: collectReplyKeyboard(output),
    edited,
    output,
  });

  const lastTouched = (): TestMessage | undefined => {
    const last = [...adapter.sent.map((s) => ({ t: s.timestamp, id: s.messageId, c: s.chatId, i: 0 })),
      ...adapter.edited.map((e, i) => ({ t: e.timestamp, id: e.messageId, c: e.chatId, i: i + 1 }))]
      .filter((x) => String(x.c) === chatId);
    if (!last.length) return undefined;
    // Order by time, then by edit order for same-millisecond events.
    last.sort((a, b) => a.t - b.t || a.i - b.i);
    const id = last.at(-1)!.id;
    return messages().find((m) => m.id === id);
  };

  return {
    bot,
    adapter,
    get messages() { return messages(); },
    get lastMessage() { return lastTouched(); },
    get apiCalls() { return adapter.apiCalls; },

    async send(text) {
      await adapter.simulateMessage(chatId, userId, text);
      return lastTouched();
    },

    async click(label) {
      const all = messages();
      for (let i = all.length - 1; i >= 0; i--) {
        const button = all[i].buttons.flat().find((b) => labelMatches(b.text, label));
        if (!button) continue;
        if (button.data == null) throw new Error(`[teact/testing] Button "${button.text}" is a URL/web-app button — it can't be clicked.`);
        await adapter.simulateCallback(chatId, userId, button.data, String(all[i].id));
        return lastTouched();
      }
      const visible = all.at(-1)?.buttons.map((r) => r.map((b) => `"${b.text}"`).join(' ')).join(' | ') || '(none)';
      throw new Error(`[teact/testing] No button matching ${String(label)}. Buttons on the latest message: ${visible}`);
    },

    async event(updateType, raw = {}) {
      await adapter.simulateEvent(chatId, userId, updateType, raw);
    },

    stop: () => bot.stop(),
  };
}
