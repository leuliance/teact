import { Bot, webhookCallback, type Context as GrammyContext, GrammyError, HttpError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type { Adapter, BotContext, OutputNode } from '@teactjs/core';
import { serializeOutput, type SendMethod } from './serialize';
import { createServer, type Server } from 'node:http';

export interface TelegramAdapterConfig {
  token: string;
}

export interface WebhookConfig {
  /** Public URL (e.g. https://mybot.example.com) */
  domain: string;
  /** Port to listen on (default: 3000) */
  port?: number;
  /** URL path for the webhook endpoint (default: /webhook) */
  path?: string;
  /** Secret token for verifying Telegram requests */
  secretToken?: string;
}

export interface ListenOptions {
  /** Set to false to skip auto-start (manual control). */
  polling?: boolean;
  /** If provided, uses webhook mode instead of polling. */
  webhook?: WebhookConfig;
}

type EventHandler = (ctx: BotContext) => void | Promise<void>;

/**
 * Telegram platform adapter powered by grammY.
 *
 * Lifecycle: connect() → use() → listen()
 *   1. connect() — creates the Grammy Bot instance.
 *   2. use()     — registers Grammy middleware (conversations, session, etc.).
 *   3. listen()  — registers Teact bridge handlers, then starts polling or webhook.
 */
export class TelegramAdapter implements Adapter {
  readonly name = 'telegram';
  private bot: Bot | null = null;
  private httpServer: Server | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  private bridgeRegistered = false;
  // A <Notification> rendered in response to a callback query is stashed here (keyed by
  // String(chatId) so concurrent chats don't clobber each other) and flushed as the answer
  // to that query after the render completes — see the callback_query:data bridge handler.
  private pendingNotifications = new Map<string, { text: string; showAlert?: boolean }>();
  // The Telegram method last used for each chat's tracked message. Editing text onto a
  // photo (or vice-versa) is impossible, so canEdit() consults this to fall back to send.
  private lastMethod = new Map<string, SendMethod>();

  /** Register a handler for a given event (e.g. `'message'`, `'callback_query'`). */
  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  /** Remove a previously registered event handler. */
  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  private async emit(event: string, ctx: BotContext): Promise<void> {
    for (const handler of this.listeners.get(event) ?? []) {
      await handler(ctx);
    }
  }

  /** Step 1 — create the Grammy Bot with auto-retry. Does NOT start polling. */
  async connect(config: TelegramAdapterConfig): Promise<void> {
    if (!config.token) throw new Error('TELEGRAM_BOT_TOKEN is required');
    this.bot = new Bot(config.token);
    this.bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));
    this.bot.catch((err) => {
      const ctx = err.ctx;
      const e = err.error;
      const chatId = ctx?.chat?.id ?? 'unknown';
      if (e instanceof GrammyError) {
        console.error(`[telegram] API error in chat ${chatId}: ${e.description} (${e.error_code})`);
      } else if (e instanceof HttpError) {
        console.error(`[telegram] Network error in chat ${chatId}: ${e.message}`);
      } else {
        console.error(`[telegram] Unexpected error in chat ${chatId}:`, e);
      }
    });
  }

  /** Register Grammy middleware (call between connect() and listen()). */
  use(...middlewares: any[]): void {
    if (!this.bot) throw new Error('Adapter not connected — call connect() first');
    for (const m of middlewares) this.bot.use(m);
  }

  /** Wire grammY updates → Teact events. Idempotent; used by both polling and webhook. */
  private registerBridge(): void {
    if (!this.bot) throw new Error('Adapter not connected');
    if (this.bridgeRegistered) return;
    this.bridgeRegistered = true;

    this.bot.on('message', async (ctx) => {
      await this.emit('message', this.mapContext(ctx));
    });

    this.bot.on('callback_query:data', async (ctx) => {
      const chatId = String(ctx.chat?.id ?? '');
      this.pendingNotifications.delete(chatId);
      // Render FIRST — a <Notification> in the render populates pendingNotifications —
      // then answer the query with it (toast/alert), or an empty answer to stop the
      // button's loading spinner. Awaited so it flushes before the isolate freezes on edge.
      await this.emit('callback_query', this.mapContext(ctx));
      const note = this.pendingNotifications.get(chatId);
      this.pendingNotifications.delete(chatId);
      try {
        await ctx.answerCallbackQuery(note ? { text: note.text, show_alert: note.showAlert } : undefined);
      } catch {
        // Query may have expired (>15 min) — nothing actionable.
      }
    });

    this.bot.on('pre_checkout_query', async (ctx) => {
      await ctx.answerPreCheckoutQuery(true);
    });
  }

  /**
   * A web-standard webhook handler: `(request: Request) => Promise<Response>`.
   *
   * This is the deploy-anywhere entry point — Cloudflare Workers, Vercel/Deno Edge,
   * Bun.serve, or Node (via an adapter). Point your Telegram webhook at the URL that
   * invokes this and the bot runs serverless (one update per request, no polling).
   */
  webhookCallback(opts: { secretToken?: string } = {}): (request: Request) => Promise<Response> {
    if (!this.bot) throw new Error('Adapter not connected — call connect() first');
    this.registerBridge();
    return webhookCallback(this.bot, 'std/http', {
      secretToken: opts.secretToken,
    }) as (request: Request) => Promise<Response>;
  }

  /** Step 2 — register Teact bridge handlers, then start polling or webhook. */
  async listen(opts: ListenOptions = {}): Promise<void> {
    if (!this.bot) throw new Error('Adapter not connected');

    this.registerBridge();

    if (opts.webhook) {
      await this.startWebhook(opts.webhook);
    } else if (opts.polling !== false) {
      console.log('[telegram] Starting polling…');
      this.bot.start({
        onStart: (info) =>
          console.log(`[telegram] Connected as @${info.username} (${info.first_name})`),
      });
    }
  }

  /** Stop polling/webhook and disconnect the bot. */
  async disconnect(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    await this.bot?.stop();
    this.bot = null;
    console.log('[telegram] Disconnected');
  }

  // ---- Send / Edit / Buttons / Commands ----

  /**
   * Send a rendered output tree to a Telegram chat.
   *
   * @param chatId - Target chat ID.
   * @param output - Serialized component tree produced by the Teact renderer.
   * @returns The `message_id` of the sent message, or `undefined`.
   */
  async send(chatId: string | number, output: OutputNode): Promise<number | undefined> {
    if (!this.bot) throw new Error('Adapter not connected');
    const payload = serializeOutput(output);

    const inlineMarkup = payload.keyboard
      ? { inline_keyboard: payload.keyboard }
      : undefined;

    const removeKbd = payload.removeKeyboard
      ? { remove_keyboard: true as const }
      : undefined;

    const replyKbd = payload.replyKeyboard
      ? {
          keyboard: payload.replyKeyboard.rows,
          resize_keyboard: payload.replyKeyboard.resizeKeyboard ?? true,
          one_time_keyboard: payload.replyKeyboard.oneTimeKeyboard,
          input_field_placeholder: payload.replyKeyboard.placeholder,
          is_persistent: payload.replyKeyboard.isPersistent,
        }
      : undefined;

    const replyMarkup = removeKbd ?? replyKbd ?? inlineMarkup;
    const captionOpts: Record<string, any> = {};
    if (payload.parseMode) captionOpts.parse_mode = payload.parseMode;
    if (replyMarkup) captionOpts.reply_markup = replyMarkup;

    if (payload.notification) {
      this.pendingNotifications.set(String(chatId), payload.notification);
    }
    // Remember what we're about to send so a later canEdit() can avoid editing text
    // onto a media message (or vice-versa), which Telegram rejects.
    this.lastMethod.set(String(chatId), payload.method);

    switch (payload.method) {
      case 'sendPhoto': {
        if (payload.hasSpoiler) captionOpts.has_spoiler = true;
        const msg = await this.bot.api.sendPhoto(chatId, payload.photo!, {
          caption: payload.text || undefined,
          ...captionOpts,
        });
        return msg.message_id;
      }

      case 'sendDocument': {
        const msg = await this.bot.api.sendDocument(chatId, payload.document!, {
          caption: payload.text || undefined,
          ...captionOpts,
        });
        return msg.message_id;
      }

      case 'sendVideo': {
        const opts: Record<string, any> = { ...captionOpts, caption: payload.text || undefined };
        if (payload.width) opts.width = payload.width;
        if (payload.height) opts.height = payload.height;
        if (payload.duration) opts.duration = payload.duration;
        if (payload.supportsStreaming) opts.supports_streaming = true;
        if (payload.hasSpoiler) opts.has_spoiler = true;
        const msg = await this.bot.api.sendVideo(chatId, payload.video!, opts);
        return msg.message_id;
      }

      case 'sendAnimation': {
        const opts: Record<string, any> = { ...captionOpts, caption: payload.text || undefined };
        if (payload.width) opts.width = payload.width;
        if (payload.height) opts.height = payload.height;
        if (payload.duration) opts.duration = payload.duration;
        if (payload.hasSpoiler) opts.has_spoiler = true;
        const msg = await this.bot.api.sendAnimation(chatId, payload.animation!, opts);
        return msg.message_id;
      }

      case 'sendVoice': {
        const opts: Record<string, any> = { ...captionOpts, caption: payload.text || undefined };
        if (payload.duration) opts.duration = payload.duration;
        const msg = await this.bot.api.sendVoice(chatId, payload.voice!, opts);
        return msg.message_id;
      }

      case 'sendAudio': {
        const opts: Record<string, any> = { ...captionOpts, caption: payload.text || undefined };
        if (payload.performer) opts.performer = payload.performer;
        if (payload.title) opts.title = payload.title;
        if (payload.duration) opts.duration = payload.duration;
        const msg = await this.bot.api.sendAudio(chatId, payload.audio!, opts);
        return msg.message_id;
      }

      case 'sendVideoNote': {
        const opts: Record<string, any> = { ...captionOpts };
        if (payload.duration) opts.duration = payload.duration;
        if (payload.length) opts.length = payload.length;
        const msg = await this.bot.api.sendVideoNote(chatId, payload.videoNote!, opts);
        return msg.message_id;
      }

      case 'sendSticker': {
        const opts: Record<string, any> = { ...captionOpts };
        if (payload.emoji) opts.emoji = payload.emoji;
        const msg = await this.bot.api.sendSticker(chatId, payload.sticker!, opts);
        return msg.message_id;
      }

      case 'sendContact': {
        const opts: Record<string, any> = {};
        if (payload.lastName) opts.last_name = payload.lastName;
        if (payload.vcard) opts.vcard = payload.vcard;
        if (replyMarkup) opts.reply_markup = replyMarkup;
        const msg = await this.bot.api.sendContact(chatId, payload.phoneNumber!, payload.firstName!, opts);
        return msg.message_id;
      }

      case 'sendLocation': {
        const opts: Record<string, any> = {};
        if (payload.livePeriod) opts.live_period = payload.livePeriod;
        if (payload.horizontalAccuracy) opts.horizontal_accuracy = payload.horizontalAccuracy;
        if (payload.heading) opts.heading = payload.heading;
        if (payload.proximityAlertRadius) opts.proximity_alert_radius = payload.proximityAlertRadius;
        if (replyMarkup) opts.reply_markup = replyMarkup;
        const msg = await this.bot.api.sendLocation(chatId, payload.latitude!, payload.longitude!, opts);
        return msg.message_id;
      }

      case 'sendVenue': {
        const opts: Record<string, any> = {};
        if (payload.foursquareId) opts.foursquare_id = payload.foursquareId;
        if (payload.foursquareType) opts.foursquare_type = payload.foursquareType;
        if (payload.googlePlaceId) opts.google_place_id = payload.googlePlaceId;
        if (payload.googlePlaceType) opts.google_place_type = payload.googlePlaceType;
        if (replyMarkup) opts.reply_markup = replyMarkup;
        const msg = await this.bot.api.sendVenue(
          chatId, payload.latitude!, payload.longitude!,
          payload.venueTitle!, payload.venueAddress!, opts,
        );
        return msg.message_id;
      }

      case 'sendMediaGroup': {
        if (payload.mediaGroup && payload.mediaGroup.length > 0) {
          const msgs = await this.bot.api.sendMediaGroup(chatId, payload.mediaGroup as any);
          return msgs[0]?.message_id;
        }
        return undefined;
      }

      case 'sendPoll': {
        const pollOpts: Record<string, any> = {};
        if (payload.pollIsAnonymous != null) pollOpts.is_anonymous = payload.pollIsAnonymous;
        if (payload.pollType) pollOpts.type = payload.pollType;
        if (payload.pollAllowsMultipleAnswers) pollOpts.allows_multiple_answers = true;
        if (payload.pollCorrectOptionId != null) pollOpts.correct_option_id = payload.pollCorrectOptionId;
        if (payload.pollExplanation) pollOpts.explanation = payload.pollExplanation;
        if (payload.pollExplanationParseMode) pollOpts.explanation_parse_mode = payload.pollExplanationParseMode;
        if (payload.pollOpenPeriod) pollOpts.open_period = payload.pollOpenPeriod;
        if (payload.pollIsClosed) pollOpts.is_closed = true;
        if (replyMarkup) pollOpts.reply_markup = replyMarkup;
        const options = (payload.pollOptions ?? []).map(text => ({ text }));
        const msg = await this.bot.api.sendPoll(chatId, payload.pollQuestion!, options, pollOpts);
        return msg.message_id;
      }

      default: {
        const text = payload.text?.trim();
        if (!text) {
          if (replyMarkup) {
            console.warn('[teact] A <Message> has buttons but no text — Telegram requires text to attach a keyboard, so nothing was sent.');
          }
          return undefined;
        }

        const msgOpts: Record<string, any> = {};
        if (payload.parseMode) msgOpts.parse_mode = payload.parseMode;
        if (payload.disablePreview) msgOpts.link_preview_options = { is_disabled: true };
        if (replyMarkup) msgOpts.reply_markup = replyMarkup;

        const msg = await this.bot.api.sendMessage(chatId, text, msgOpts);
        return msg.message_id;
      }
    }
  }

  /**
   * Whether a rendered tree can be applied as an in-place text edit.
   * Used by the core engine to decide edit-vs-send without importing the serializer.
   *
   * A text edit is only valid when BOTH the new tree is a plain message AND the last
   * message we sent to this chat was also a plain message — you cannot edit text onto
   * a photo/media message (Telegram rejects it), so in that case we return false and
   * the engine sends a fresh message instead.
   */
  canEdit(output: OutputNode, chatId?: string | number): boolean {
    const payload = serializeOutput(output);
    if (payload.method !== 'sendMessage' || payload.replyKeyboard || payload.removeKeyboard) {
      return false;
    }
    if (chatId != null) {
      const key = String(chatId);
      if (this.lastMethod.has(key) && this.lastMethod.get(key) !== 'sendMessage') return false;
    }
    return true;
  }

  /**
   * Edit an existing message's text and inline keyboard.
   *
   * @param chatId - Target chat ID.
   * @param messageId - ID of the message to edit.
   * @param output - New rendered output tree.
   */
  async edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void> {
    if (!this.bot) throw new Error('Adapter not connected');
    const payload = serializeOutput(output);

    const replyMarkup = payload.keyboard
      ? { inline_keyboard: payload.keyboard }
      : { inline_keyboard: [] as any[] };

    const text = payload.text?.trim();
    if (!text) return;

    const editOpts: Record<string, any> = { reply_markup: replyMarkup };
    if (payload.parseMode) editOpts.parse_mode = payload.parseMode;

    try {
      await this.bot.api.editMessageText(chatId, messageId, text, editOpts);
      this.lastMethod.set(String(chatId), 'sendMessage');
    } catch (err: any) {
      const msg = err?.message || err?.description || '';
      if (msg.includes('message is not modified')) return;
      throw err;
    }
  }

  /** Remove all inline keyboard buttons from a message. */
  async clearButtons(chatId: string | number, messageId: number): Promise<void> {
    if (!this.bot) throw new Error('Adapter not connected');
    try {
      await this.bot.api.editMessageReplyMarkup(chatId, messageId, {
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // Ignore if message has no buttons or is not modifiable
    }
  }

  /** Register bot commands with Telegram's command menu. */
  async setCommands(commands: { command: string; description: string }[]): Promise<void> {
    if (!this.bot) throw new Error('Adapter not connected');
    await this.bot.api.setMyCommands(commands);
  }

  /** Access the raw grammY Bot instance for advanced usage (plugins, middleware). */
  getBot(): Bot {
    if (!this.bot) throw new Error('Adapter not connected');
    return this.bot;
  }

  // ---- Private ----

  private async startWebhook(cfg: WebhookConfig): Promise<void> {
    if (!this.bot) throw new Error('Adapter not connected');
    const port = cfg.port ?? 3000;
    const path = cfg.path ?? '/webhook';
    const url = `${cfg.domain.replace(/\/+$/, '')}${path}`;
    const bot = this.bot;

    await bot.init();
    await bot.api.setWebhook(url, {
      secret_token: cfg.secretToken,
    });

    this.httpServer = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === path) {
        if (cfg.secretToken) {
          const token = req.headers['x-telegram-bot-api-secret-token'];
          if (token !== cfg.secretToken) { res.writeHead(401).end(); return; }
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          await bot.handleUpdate(JSON.parse(body));
        } catch (e) {
          console.error('[telegram] Webhook update error:', e);
        }
        res.writeHead(200).end('OK');
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`[telegram] Port ${port} is already in use. Choose a different webhook port.`));
        } else {
          reject(err);
        }
      });
      this.httpServer!.listen(port, () => {
        console.log(`[telegram] Webhook listening on :${port}${path}`);
        console.log(`[telegram] Webhook URL: ${url}`);
        resolve();
      });
    });
  }

  private mapContext(ctx: GrammyContext): BotContext {
    const chatId = String(ctx.chat?.id ?? '');
    const from = ctx.from;
    return {
      chatId,
      userId: String(from?.id ?? ''),
      user: {
        id: String(from?.id ?? ''),
        username: from?.username,
        firstName: from?.first_name,
        lastName: from?.last_name,
        isBot: from?.is_bot,
        platform: 'telegram',
      },
      platform: 'telegram',
      messageId: String(ctx.message?.message_id ?? ctx.callbackQuery?.message?.message_id ?? ''),
      text: ctx.message?.text,
      callbackData: ctx.callbackQuery?.data,
      botUsername: ctx.me?.username,
      raw: ctx,
    };
  }
}
