import { session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { TeactPlugin } from '@teactjs/runtime';

const CONVO_PREFIX = '__convo:';

// ---- Validation (self-contained, same API as useForm) ----

type ValidateFn = (value: string) => true | string;
interface SchemaLike {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } };
}
export type Validator = ValidateFn | SchemaLike;

function runValidation(v: Validator, value: string): true | string {
  if (typeof v === 'function') return v(value);
  if (typeof v === 'object' && 'safeParse' in v) {
    const r = v.safeParse(value);
    return r.success ? true : ((r as any).error?.issues?.[0]?.message ?? 'Invalid input');
  }
  return true;
}

// ---- Conversation interface ----

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

export interface Conversation {
  /** Send a text message and wait for the user's text reply. Auto-retries on validation failure. */
  prompt(text: string, opts?: PromptOptions): Promise<string>;
  /** Send a text message without waiting. */
  send(text: string): Promise<void>;
  /** Wait for the user's next text message. */
  wait(opts?: PromptOptions): Promise<string>;
  /** Send a message with button options and wait for selection. */
  ask(text: string, options: AskOption[][]): Promise<string>;
  /** Stream an async generator's output as a live-updating message. */
  stream(source: AsyncIterable<string>): Promise<void>;

  /** Send a photo. */
  replyWithPhoto(src: string, opts?: { caption?: string; parse_mode?: string; has_spoiler?: boolean }): Promise<void>;
  /** Send a video. */
  replyWithVideo(src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number; supports_streaming?: boolean }): Promise<void>;
  /** Send an animation (GIF). */
  replyWithAnimation(src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number }): Promise<void>;
  /** Send a voice message. */
  replyWithVoice(src: string, opts?: { caption?: string; parse_mode?: string; duration?: number }): Promise<void>;
  /** Send an audio file. */
  replyWithAudio(src: string, opts?: { caption?: string; parse_mode?: string; performer?: string; title?: string; duration?: number }): Promise<void>;
  /** Send a round video note. */
  replyWithVideoNote(src: string, opts?: { duration?: number; length?: number }): Promise<void>;
  /** Send a sticker. */
  replyWithSticker(src: string, opts?: { emoji?: string }): Promise<void>;
  /** Send a document/file. */
  replyWithDocument(src: string, opts?: { caption?: string; filename?: string }): Promise<void>;
  /** Send a contact card. */
  replyWithContact(phoneNumber: string, firstName: string, opts?: { last_name?: string; vcard?: string }): Promise<void>;
  /** Send a location pin. */
  replyWithLocation(latitude: number, longitude: number, opts?: { live_period?: number; horizontal_accuracy?: number; heading?: number; proximity_alert_radius?: number }): Promise<void>;
  /** Send a venue. */
  replyWithVenue(latitude: number, longitude: number, title: string, address: string, opts?: { foursquare_id?: string; google_place_id?: string }): Promise<void>;
  /** Send a media group (album). */
  replyWithMediaGroup(media: MediaGroupItem[]): Promise<void>;
  /** Send a poll. */
  replyWithPoll(question: string, options: string[], opts?: { is_anonymous?: boolean; type?: 'regular' | 'quiz'; allows_multiple_answers?: boolean; correct_option_id?: number; explanation?: string; open_period?: number }): Promise<void>;

  /** Show a "Share Contact" reply-keyboard and wait for the user's contact. Returns { phone_number, first_name, last_name?, user_id? }. */
  requestContact(promptText: string, buttonText?: string): Promise<{ phone_number: string; first_name: string; last_name?: string; user_id?: number }>;
  /** Show a "Share Location" reply-keyboard and wait for the user's location. Returns { latitude, longitude }. */
  requestLocation(promptText: string, buttonText?: string): Promise<{ latitude: number; longitude: number }>;

  /** The current chat ID. */
  chatId: number;
  /** The Grammy API object for advanced calls. */
  api: any;
  /** The Grammy chat object. */
  chat: any;
  /** Raw Grammy objects — escape hatch. */
  raw: { conversation: any; ctx: any };
}

function createConversationContext(grammyConvo: any, ctx: any): Conversation {
  const chatId = ctx.chat?.id;

  return {
    chatId,
    api: ctx.api,
    chat: ctx.chat,

    async prompt(text, opts) {
      let promptText = text;
      while (true) {
        await ctx.reply(promptText);
        const result = await grammyConvo.waitFor('message:text');
        const value = result.message?.text ?? '';
        if (opts?.validate) {
          const check = runValidation(opts.validate, value);
          if (check !== true) {
            promptText = `⚠️ ${check}\n\n${text}`;
            continue;
          }
        }
        return value;
      }
    },

    async send(text) {
      await ctx.reply(text);
    },

    async wait(opts) {
      while (true) {
        const result = await grammyConvo.waitFor('message:text');
        const value = result.message?.text ?? '';
        if (opts?.validate) {
          const check = runValidation(opts.validate, value);
          if (check !== true) {
            await ctx.reply(`⚠️ ${check}`);
            continue;
          }
        }
        return value;
      }
    },

    async ask(text, options) {
      const keyboard = options.map(row =>
        row.map(opt => {
          const t = typeof opt === 'string' ? opt : opt.text;
          const v = typeof opt === 'string' ? opt : opt.value;
          return { text: t, callback_data: v };
        }),
      );
      await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
      const result = await grammyConvo.waitFor('callback_query:data');
      await result.answerCallbackQuery();
      return result.callbackQuery.data;
    },

    async stream(source) {
      if (typeof (ctx as any).replyWithStream === 'function') {
        await (ctx as any).replyWithStream(source);
      } else {
        let text = '';
        let msgId: number | undefined;
        let lastEdit = 0;
        for await (const chunk of source) {
          text += chunk;
          const now = Date.now();
          if (!msgId) {
            const msg = await ctx.reply(text);
            msgId = msg.message_id;
            lastEdit = now;
          } else if (now - lastEdit >= 500) {
            await ctx.api.editMessageText(chatId, msgId, text).catch(() => {});
            lastEdit = now;
          }
        }
        if (msgId) {
          await ctx.api.editMessageText(chatId, msgId, text).catch(() => {});
        }
      }
    },

    async replyWithPhoto(src, opts) {
      await ctx.api.sendPhoto(chatId, src, opts);
    },

    async replyWithVideo(src, opts) {
      await ctx.api.sendVideo(chatId, src, opts);
    },

    async replyWithAnimation(src, opts) {
      await ctx.api.sendAnimation(chatId, src, opts);
    },

    async replyWithVoice(src, opts) {
      await ctx.api.sendVoice(chatId, src, opts);
    },

    async replyWithAudio(src, opts) {
      await ctx.api.sendAudio(chatId, src, opts);
    },

    async replyWithVideoNote(src, opts) {
      await ctx.api.sendVideoNote(chatId, src, opts);
    },

    async replyWithSticker(src, opts) {
      await ctx.api.sendSticker(chatId, src, opts);
    },

    async replyWithDocument(src, opts) {
      await ctx.api.sendDocument(chatId, src, opts);
    },

    async replyWithContact(phoneNumber, firstName, opts) {
      await ctx.api.sendContact(chatId, phoneNumber, firstName, opts);
    },

    async replyWithLocation(latitude, longitude, opts) {
      await ctx.api.sendLocation(chatId, latitude, longitude, opts);
    },

    async replyWithVenue(latitude, longitude, title, address, opts) {
      await ctx.api.sendVenue(chatId, latitude, longitude, title, address, opts);
    },

    async replyWithMediaGroup(media) {
      await ctx.api.sendMediaGroup(chatId, media);
    },

    async replyWithPoll(question, options, opts) {
      const pollOptions = options.map(text => ({ text }));
      await ctx.api.sendPoll(chatId, question, pollOptions, opts);
    },

    async requestContact(promptText, buttonText = '📱 Share Contact') {
      await ctx.api.sendMessage(chatId, promptText, {
        reply_markup: {
          keyboard: [[{ text: buttonText, request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      const result = await grammyConvo.waitFor('message:contact');
      await ctx.api.sendMessage(chatId, '✓', { reply_markup: { remove_keyboard: true } });
      const c = result.message.contact;
      return {
        phone_number: c.phone_number,
        first_name: c.first_name,
        last_name: c.last_name,
        user_id: c.user_id,
      };
    },

    async requestLocation(promptText, buttonText = '📍 Share Location') {
      await ctx.api.sendMessage(chatId, promptText, {
        reply_markup: {
          keyboard: [[{ text: buttonText, request_location: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      const result = await grammyConvo.waitFor('message:location');
      await ctx.api.sendMessage(chatId, '✓', { reply_markup: { remove_keyboard: true } });
      const loc = result.message.location;
      return { latitude: loc.latitude, longitude: loc.longitude };
    },

    raw: { conversation: grammyConvo, ctx },
  };
}

// ---- Types ----

export type ConversationHandler = (conversation: Conversation) => Promise<void>;
export type RawConversationHandler = (conversation: any, ctx: any) => Promise<void>;

export interface ConversationDef {
  handler: ConversationHandler;
  command?: string;
}

interface InternalDef {
  grammyHandler: RawConversationHandler;
  command?: string;
}

export interface ConversationsPluginOptions {
  /** Named conversation definitions. */
  [name: string]: ConversationDef | ConversationHandler;
}

export interface ConversationsConfig {
  /** Conversation definitions (same as passing to conversationsPlugin). */
  conversations?: ConversationsPluginOptions;
  /**
   * When true (default), automatically exit all active conversations
   * before entering a new one. Prevents the "already in a conversation" error.
   */
  exitActive?: boolean;
}

// ---- Global registry ----

const globalRegistry = new Map<string, InternalDef>();

/**
 * Define a conversation — co-locate the handler with the component that triggers it.
 *
 * @example
 * const feedback = defineConversation('feedback', async (conversation) => {
 *   const name = await conversation.prompt("What's your name?");
 *   await conversation.replyWithPhoto('https://example.com/thanks.png', { caption: `Thanks ${name}!` });
 *   await conversation.replyWithLocation(37.77, -122.42);
 *   await conversation.send('Done!');
 * });
 */
export function defineConversation(
  name: string,
  handlerOrDef: ConversationHandler | ConversationDef,
): string {
  const def = typeof handlerOrDef === 'function'
    ? { handler: handlerOrDef }
    : handlerOrDef;

  const grammyHandler: RawConversationHandler = async (conversation, ctx) => {
    await def.handler(createConversationContext(conversation, ctx));
  };

  globalRegistry.set(name, { grammyHandler, command: def.command });
  return name;
}

// ---- conversationsPlugin ----

function normalise(entry: ConversationDef | ConversationHandler): InternalDef {
  const def = typeof entry === 'function' ? { handler: entry } : entry;
  const grammyHandler: RawConversationHandler = async (conversation, ctx) => {
    await def.handler(createConversationContext(conversation, ctx));
  };
  return { grammyHandler, command: def.command };
}

async function safeEnterConversation(ctx: any, convoName: string, exitActive: boolean): Promise<void> {
  if (exitActive) {
    const active: Record<string, number> = (ctx as any).conversation?.active
      ? await (ctx as any).conversation.active()
      : {};
    const hasActive = Object.values(active).some(count => count > 0);
    if (hasActive) {
      await (ctx as any).conversation.exitAll();
    }
  }
  await (ctx as any).conversation.enter(convoName);
}

export function conversationsPlugin(
  configOrDefs?: ConversationsConfig | ConversationsPluginOptions,
): TeactPlugin {
  let explicitDefs: ConversationsPluginOptions | undefined;
  let exitActive = true;

  if (configOrDefs) {
    if ('exitActive' in configOrDefs || 'conversations' in configOrDefs) {
      const cfg = configOrDefs as ConversationsConfig;
      explicitDefs = cfg.conversations;
      exitActive = cfg.exitActive ?? true;
    } else {
      explicitDefs = configOrDefs as ConversationsPluginOptions;
    }
  }

  return {
    name: 'grammy-conversations',

    onStart(adapter) {
      adapter.use(session({ initial: () => ({}) }));
      adapter.use(conversations());

      const commandMap = new Map<string, string>();

      const merged = new Map<string, InternalDef>(globalRegistry);
      if (explicitDefs) {
        for (const [name, raw] of Object.entries(explicitDefs)) {
          merged.set(name, normalise(raw));
        }
      }

      for (const [name, def] of merged) {
        adapter.use(createConversation(def.grammyHandler, name));
        if (def.command) commandMap.set(def.command, name);
      }

      const bot = adapter.getBot();

      bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data?.startsWith(CONVO_PREFIX)) {
          const convoName = data.slice(CONVO_PREFIX.length);
          await ctx.answerCallbackQuery();
          await safeEnterConversation(ctx, convoName, exitActive);
          return;
        }
        await next();
      });

      if (commandMap.size > 0) {
        bot.on('message:text', async (ctx, next) => {
          const text = ctx.message?.text;
          if (text?.startsWith('/')) {
            const cmdName = text.slice(1).split(/\s+/)[0].split('@')[0].toLowerCase();
            const convoName = commandMap.get(cmdName);
            if (convoName) {
              await safeEnterConversation(ctx, convoName, exitActive);
              return;
            }
          }
          await next();
        });
      }
    },
  };
}
