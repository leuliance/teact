import type { BotContext, Middleware, TeactPlugin } from '@teactjs/core';
import { createTelegramApi, isNotModifiedError, type TelegramApi } from './api';

const CONVO_PREFIX = '__convo:';
const ASK_PREFIX = '__cq:';

// ---- Validation (same contract as useForm) ----

type ValidateFn = (value: string) => true | string;
interface SchemaLike {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } };
}
export type Validator = ValidateFn | SchemaLike;

function runValidation(v: Validator, value: string): true | string {
  if (typeof v === 'function') return v(value);
  if (typeof v === 'object' && 'safeParse' in v) {
    const r = v.safeParse(value);
    return r.success ? true : (r.error?.issues?.[0]?.message ?? 'Invalid input');
  }
  return true;
}

// ---- Public types ----

type AskOption = string | { text: string; value: string };

export interface PromptOptions {
  /** Zod schema, function validator, or any object with `.safeParse()`. */
  validate?: Validator;
}

export interface MediaGroupItem {
  type: 'photo' | 'video';
  media: string;
  caption?: string;
  parse_mode?: string;
}

/** Thrown inside a conversation handler when the conversation is cancelled or times out. */
export class ConversationCancelledError extends Error {
  constructor(reason: string) {
    super(`Conversation cancelled: ${reason}`);
    this.name = 'ConversationCancelledError';
  }
}

/** The `conversation` object your handler receives. Works with every Telegram driver. */
export interface Conversation {
  /** Send a text message and wait for the user's text reply. Re-asks on validation failure. */
  prompt(text: string, opts?: PromptOptions): Promise<string>;
  /** Send a text message without waiting. */
  send(text: string, opts?: { parse_mode?: string }): Promise<void>;
  /** Wait for the user's next text message. */
  wait(opts?: PromptOptions): Promise<string>;
  /** Send a message with button options and wait for a tap. Resolves to the option's value. */
  ask(text: string, options: AskOption[][]): Promise<string>;
  /** Wait for the next update in this chat that satisfies `filter` (escape hatch). */
  waitFor(filter: (ctx: BotContext) => boolean): Promise<BotContext>;
  /** Stream an async iterable of text chunks into one live-updating message. */
  stream(source: AsyncIterable<string>, opts?: { throttleMs?: number }): Promise<void>;

  replyWithPhoto(src: string, opts?: { caption?: string; parse_mode?: string; has_spoiler?: boolean }): Promise<void>;
  replyWithVideo(src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number; supports_streaming?: boolean }): Promise<void>;
  replyWithAnimation(src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number }): Promise<void>;
  replyWithVoice(src: string, opts?: { caption?: string; parse_mode?: string; duration?: number }): Promise<void>;
  replyWithAudio(src: string, opts?: { caption?: string; parse_mode?: string; performer?: string; title?: string; duration?: number }): Promise<void>;
  replyWithVideoNote(src: string, opts?: { duration?: number; length?: number }): Promise<void>;
  replyWithSticker(src: string, opts?: { emoji?: string }): Promise<void>;
  replyWithDocument(src: string, opts?: { caption?: string; parse_mode?: string }): Promise<void>;
  replyWithContact(phoneNumber: string, firstName: string, opts?: { last_name?: string; vcard?: string }): Promise<void>;
  replyWithLocation(latitude: number, longitude: number, opts?: { live_period?: number; horizontal_accuracy?: number; heading?: number; proximity_alert_radius?: number }): Promise<void>;
  replyWithVenue(latitude: number, longitude: number, title: string, address: string, opts?: { foursquare_id?: string; google_place_id?: string }): Promise<void>;
  replyWithMediaGroup(media: MediaGroupItem[]): Promise<void>;
  replyWithPoll(question: string, options: string[], opts?: { is_anonymous?: boolean; type?: 'regular' | 'quiz'; allows_multiple_answers?: boolean; correct_option_id?: number; explanation?: string; open_period?: number }): Promise<void>;

  /** Show a "Share Contact" reply keyboard and wait for the user's contact. */
  requestContact(promptText: string, buttonText?: string): Promise<{ phone_number: string; first_name: string; last_name?: string; user_id?: number }>;
  /** Show a "Share Location" reply keyboard and wait for the user's location. */
  requestLocation(promptText: string, buttonText?: string): Promise<{ latitude: number; longitude: number }>;

  /** The current chat ID. */
  chatId: number;
  /** Bot API access: `conversation.api.sendMessage({ chat_id, text })`. */
  api: TelegramApi;
  /** The Telegram chat object of the update that started the conversation. */
  chat: any;
  /** Escape hatch: the Teact context that started the conversation. */
  raw: { ctx: BotContext };
}

export type ConversationHandler = (conversation: Conversation) => Promise<void>;

export interface ConversationDef {
  handler: ConversationHandler;
  /** Start this conversation when the user sends `/<command>`. */
  command?: string;
}

export interface ConversationsPluginOptions {
  [name: string]: ConversationDef | ConversationHandler;
}

export interface ConversationsConfig {
  /** Conversation definitions (same as passing them directly to conversationsPlugin). */
  conversations?: ConversationsPluginOptions;
  /** Cancel an active conversation when a new one starts in the same chat. @default true */
  exitActive?: boolean;
  /** Cancel a conversation left waiting for this long (ms). @default 1 hour */
  timeoutMs?: number;
  /**
   * Commands (e.g. `/cancel`, `/start`) typed mid-conversation cancel it and are then handled
   * normally. @default true
   */
  cancelOnCommand?: boolean;
  /** Message sent when a handler throws. Set `false` to stay silent. */
  errorMessage?: string | false;
}

// ---- Global registry (defineConversation) ----

const globalRegistry = new Map<string, ConversationDef>();

/**
 * Define a conversation next to the component that triggers it. Start it with
 * `<Button conversation="feedback" />`, or set `command` to start it from `/feedback`.
 *
 * @example
 * export const feedback = defineConversation('feedback', async (conversation) => {
 *   const name = await conversation.prompt("What's your name?");
 *   const rating = await conversation.ask('Rate us:', [['1', '2', '3', '4', '5']]);
 *   await conversation.send(`Thanks ${name}! (${rating}/5)`);
 * });
 */
export function defineConversation(name: string, handlerOrDef: ConversationHandler | ConversationDef): string {
  globalRegistry.set(name, typeof handlerOrDef === 'function' ? { handler: handlerOrDef } : handlerOrDef);
  return name;
}

// ---- Engine ----

interface Waiter {
  filter: (ctx: BotContext) => boolean;
  resolve: (ctx: BotContext) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface Session {
  name: string;
  waiter: Waiter | null;
  /** Resolves when the handler next blocks on input (or finishes). */
  idle: { promise: Promise<void>; resolve: () => void };
  /** Maps `__cq:` callback ids of the current ask() to option values. */
  askValues: Map<string, string>;
  cancelled: boolean;
  cancel(reason: string): void;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

let askSeq = 0;

function isCommand(ctx: BotContext): boolean {
  return !!ctx.text?.startsWith('/');
}

function commandName(text: string): string {
  return text.slice(1).split(/\s+/)[0].split('@')[0].toLowerCase();
}

function message(ctx: BotContext): any {
  return ctx.raw?.message;
}

function createConversation(session: Session, start: BotContext, timeoutMs: number): Conversation {
  const api = (start.api as TelegramApi | undefined) ?? createTelegramApi(async () => {
    throw new Error('[teact] This adapter provides no API to conversations.');
  });
  const chatId = Number(start.chatId);
  const thread = start.threadId != null ? { message_thread_id: start.threadId } : {};
  const target = { chat_id: chatId, ...thread };

  function waitFor(filter: (ctx: BotContext) => boolean): Promise<BotContext> {
    if (session.cancelled) return Promise.reject(new ConversationCancelledError('already cancelled'));
    return new Promise<BotContext>((resolve, reject) => {
      const waiter: Waiter = { filter, resolve, reject };
      waiter.timer = setTimeout(() => session.cancel('timed out'), timeoutMs);
      session.waiter = waiter;
      // Hand control back: the update that led here has been fully handled.
      session.idle.resolve();
    });
  }

  const text = (ctx: BotContext) => !!ctx.text && !isCommand(ctx) && !ctx.callbackData;

  const conversation: Conversation = {
    chatId,
    api,
    chat: start.raw?.message?.chat ?? start.raw?.callback_query?.message?.chat ?? { id: chatId },
    raw: { ctx: start },
    waitFor,

    async prompt(question, opts) {
      let promptText = question;
      for (;;) {
        await api.sendMessage({ ...target, text: promptText });
        const reply = (await waitFor(text)).text!;
        const check = opts?.validate ? runValidation(opts.validate, reply) : true;
        if (check === true) return reply;
        promptText = `⚠️ ${check}\n\n${question}`;
      }
    },

    async send(t, opts) {
      await api.sendMessage({ ...target, text: t, parse_mode: opts?.parse_mode });
    },

    async wait(opts) {
      for (;;) {
        const reply = (await waitFor(text)).text!;
        const check = opts?.validate ? runValidation(opts.validate, reply) : true;
        if (check === true) return reply;
        await api.sendMessage({ ...target, text: `⚠️ ${check}` });
      }
    },

    async ask(question, options) {
      const nonce = (++askSeq).toString(36);
      session.askValues.clear();
      const inline_keyboard = options.map((row, ri) =>
        row.map((opt, ci) => {
          const id = `${ASK_PREFIX}${nonce}:${ri}:${ci}`;
          session.askValues.set(id, typeof opt === 'string' ? opt : opt.value);
          return { text: typeof opt === 'string' ? opt : opt.text, callback_data: id };
        }),
      );
      const sent = await api.sendMessage({ ...target, text: question, reply_markup: { inline_keyboard } });
      const picked = await waitFor((ctx) => !!ctx.callbackData && session.askValues.has(ctx.callbackData));
      const value = session.askValues.get(picked.callbackData!)!;
      session.askValues.clear();
      // Remove the buttons so the same question can't be answered twice.
      await api.editMessageReplyMarkup({ chat_id: chatId, message_id: sent.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return value;
    },

    async stream(source, opts) {
      const throttle = opts?.throttleMs ?? 1000;
      let acc = '';
      let shown = '';
      let messageId: number | undefined;
      let last = 0;
      const flush = async () => {
        const t = acc.trim() ? acc.slice(0, 4096) : '…';
        if (t === shown) return;
        if (messageId == null) {
          messageId = (await api.sendMessage({ ...target, text: t })).message_id;
        } else {
          await api.editMessageText({ chat_id: chatId, message_id: messageId, text: t }).catch((err: unknown) => {
            if (!isNotModifiedError(err)) throw err;
          });
        }
        shown = t;
        last = Date.now();
      };
      for await (const chunk of source) {
        acc += chunk;
        if (messageId == null || Date.now() - last >= throttle) await flush();
      }
      await flush();
    },

    async replyWithPhoto(src, opts) { await api.sendPhoto({ ...target, photo: src, ...opts }); },
    async replyWithVideo(src, opts) { await api.sendVideo({ ...target, video: src, ...opts }); },
    async replyWithAnimation(src, opts) { await api.sendAnimation({ ...target, animation: src, ...opts }); },
    async replyWithVoice(src, opts) { await api.sendVoice({ ...target, voice: src, ...opts }); },
    async replyWithAudio(src, opts) { await api.sendAudio({ ...target, audio: src, ...opts }); },
    async replyWithVideoNote(src, opts) { await api.sendVideoNote({ ...target, video_note: src, ...opts }); },
    async replyWithSticker(src, opts) { await api.sendSticker({ ...target, sticker: src, ...opts }); },
    async replyWithDocument(src, opts) { await api.sendDocument({ ...target, document: src, ...opts }); },
    async replyWithContact(phone_number, first_name, opts) { await api.sendContact({ ...target, phone_number, first_name, ...opts }); },
    async replyWithLocation(latitude, longitude, opts) { await api.sendLocation({ ...target, latitude, longitude, ...opts }); },
    async replyWithVenue(latitude, longitude, title, address, opts) { await api.sendVenue({ ...target, latitude, longitude, title, address, ...opts }); },
    async replyWithMediaGroup(media) { await api.sendMediaGroup({ ...target, media }); },
    async replyWithPoll(question, options, opts) {
      await api.sendPoll({ ...target, question, options: options.map((o) => ({ text: o })), ...opts });
    },

    async requestContact(promptText, buttonText = '📱 Share Contact') {
      await api.sendMessage({
        ...target, text: promptText,
        reply_markup: { keyboard: [[{ text: buttonText, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
      const c = message(await waitFor((ctx) => !!message(ctx)?.contact)).contact;
      await api.sendMessage({ ...target, text: '✓', reply_markup: { remove_keyboard: true } });
      return { phone_number: c.phone_number, first_name: c.first_name, last_name: c.last_name, user_id: c.user_id };
    },

    async requestLocation(promptText, buttonText = '📍 Share Location') {
      await api.sendMessage({
        ...target, text: promptText,
        reply_markup: { keyboard: [[{ text: buttonText, request_location: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
      const loc = message(await waitFor((ctx) => !!message(ctx)?.location)).location;
      await api.sendMessage({ ...target, text: '✓', reply_markup: { remove_keyboard: true } });
      return { latitude: loc.latitude, longitude: loc.longitude };
    },
  };
  return conversation;
}

/**
 * Imperative, `await`-style conversations — on any Telegram driver (fetch, grammY, GramIO).
 *
 * Start one with `<Button conversation="name" />` or a `command`. While a conversation
 * waits for input, the chat's updates go to it instead of the React tree. Typing a command
 * (e.g. `/start`) cancels it.
 *
 * Conversations live in memory, so they need a long-running process (polling or the
 * built-in webhook server). On serverless/edge, use the React `useConversation`/`useForm`
 * hooks instead.
 *
 * @example
 * plugins: [conversationsPlugin({
 *   signup: { command: 'signup', handler: async (c) => {
 *     const email = await c.prompt('Your email?', { validate: z.string().email() });
 *     await c.send(`Registered ${email}!`);
 *   }},
 * })]
 */
export function conversationsPlugin(configOrDefs?: ConversationsConfig | ConversationsPluginOptions): TeactPlugin {
  let explicitDefs: ConversationsPluginOptions | undefined;
  let cfg: ConversationsConfig = {};
  if (configOrDefs) {
    const keys = ['conversations', 'exitActive', 'timeoutMs', 'cancelOnCommand', 'errorMessage'];
    if (Object.keys(configOrDefs).some((k) => keys.includes(k))) {
      cfg = configOrDefs as ConversationsConfig;
      explicitDefs = cfg.conversations;
    } else {
      explicitDefs = configOrDefs as ConversationsPluginOptions;
    }
  }
  const timeoutMs = cfg.timeoutMs ?? 60 * 60 * 1000;
  const errorMessage = cfg.errorMessage ?? '⚠️ Something went wrong. Please try again.';

  const sessions = new Map<string, Session>();

  function defs(): Map<string, ConversationDef> {
    const merged = new Map(globalRegistry);
    for (const [name, raw] of Object.entries(explicitDefs ?? {})) {
      merged.set(name, typeof raw === 'function' ? { handler: raw } : raw);
    }
    return merged;
  }

  const keyOf = (ctx: BotContext) => `${ctx.platform}:${ctx.chatId}`;

  async function start(name: string, ctx: BotContext): Promise<void> {
    const def = defs().get(name);
    if (!def) {
      console.warn(`[teact] Unknown conversation "${name}". Define it with defineConversation() or pass it to conversationsPlugin().`);
      return;
    }
    const key = keyOf(ctx);
    const existing = sessions.get(key);
    if (existing) {
      if (cfg.exitActive === false) {
        console.warn(`[teact] Chat ${ctx.chatId} is already in conversation "${existing.name}".`);
        return;
      }
      existing.cancel(`replaced by "${name}"`);
    }

    const session: Session = {
      name,
      waiter: null,
      idle: deferred(),
      askValues: new Map(),
      cancelled: false,
      cancel(reason) {
        if (this.cancelled) return;
        this.cancelled = true;
        if (sessions.get(key) === this) sessions.delete(key);
        const w = this.waiter;
        this.waiter = null;
        if (w) {
          clearTimeout(w.timer);
          w.reject(new ConversationCancelledError(reason));
        }
        this.idle.resolve();
      },
    };
    sessions.set(key, session);

    const conversation = createConversation(session, ctx, timeoutMs);
    def.handler(conversation)
      .catch(async (err) => {
        if (err instanceof ConversationCancelledError) return;
        console.error(`[teact] Conversation "${name}" failed:`, err);
        if (errorMessage) await conversation.send(errorMessage).catch(() => {});
      })
      .finally(() => {
        if (sessions.get(key) === session) sessions.delete(key);
        session.waiter = null;
        session.idle.resolve();
      });
    // Return once the handler is waiting for input (or done) — its sends are complete.
    await session.idle.promise;
  }

  const middleware: Middleware = async (ctx, next) => {
    if (ctx.callbackData?.startsWith(CONVO_PREFIX)) {
      await start(ctx.callbackData.slice(CONVO_PREFIX.length), ctx);
      return false;
    }

    if (ctx.text && isCommand(ctx)) {
      const cmd = commandName(ctx.text);
      for (const [name, def] of defs()) {
        if (def.command?.toLowerCase() === cmd) {
          await start(name, ctx);
          return false;
        }
      }
    }

    const session = sessions.get(keyOf(ctx));
    if (!session) return;

    if (isCommand(ctx) && cfg.cancelOnCommand !== false) {
      session.cancel(`command ${ctx.text}`);
      return;
    }

    const waiter = session.waiter;
    if (waiter && waiter.filter(ctx)) {
      clearTimeout(waiter.timer);
      session.waiter = null;
      session.idle = deferred();
      waiter.resolve(ctx);
      await session.idle.promise;
      return false;
    }

    // Stale buttons of an earlier ask() — swallow so they don't reach the React tree.
    if (ctx.callbackData?.startsWith(ASK_PREFIX)) return false;
    // Other buttons (the app's own UI) keep working mid-conversation.
    if (ctx.callbackData) return next();
    // Non-matching messages while a conversation is active are swallowed: the user is
    // talking to the conversation, not to the React tree.
    return false;
  };

  return {
    name: 'teact-conversations',
    middleware,
    onStop() {
      for (const s of [...sessions.values()]) s.cancel('bot stopped');
    },
  };
}
