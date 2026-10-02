import type { Adapter, BotContext, ListenOptions, OutputNode } from '@teactjs/core';
import { createTelegramApi, isNotModifiedError, type TelegramApi } from './api';
import type { TelegramDriver } from './driver';
import { fetchDriver } from './drivers/fetch';
import { buildEditCall, buildSendCall, messageKind } from './methods';
import { Poller } from './polling';
import { serializeOutput, type SendMethod, type TelegramSendPayload } from './serialize';
import type { TgMessage, TgUpdate, TgUser } from './types';
import { createWebhookHandler, serveWebhook, type WebhookServer } from './webhook';

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

export interface TelegramAdapterConfig {
  /** Bot token. Defaults to the token `createBot` resolves (`TELEGRAM_BOT_TOKEN`). */
  token?: string;
  /**
   * The Telegram client library to run on. Defaults to the zero-dependency `fetchDriver()`.
   * Use `grammyDriver()` from `@teactjs/telegram/grammy` or `gramioDriver()` from
   * `@teactjs/telegram/gramio` to run inside those frameworks (and keep their plugins).
   */
  driver?: TelegramDriver;
  /**
   * Update types to receive (polling and `setWebhook`).
   * @default message, edited_message, callback_query, inline_query, chosen_inline_result,
   *          poll, poll_answer, pre_checkout_query, shipping_query, my_chat_member
   */
  allowedUpdates?: readonly string[];
  /** Drop updates that queued up while the bot was offline. @default false */
  dropPendingUpdates?: boolean;
  /**
   * Answer Telegram's `pre_checkout_query` (payments). Return `true` to approve or an error
   * message to decline. Telegram requires an answer within 10 seconds. @default approve all
   */
  onPreCheckout?: (query: NonNullable<TgUpdate['pre_checkout_query']>) => true | string | Promise<true | string>;
  /** Max concurrently processed updates while polling. @default 100 */
  concurrency?: number;
}

/** Back-compat alias. */
export type ListenOptionsCompat = ListenOptions;

type EventHandler = (ctx: BotContext) => void | Promise<void>;

export const DEFAULT_ALLOWED_UPDATES = [
  'message', 'edited_message', 'callback_query', 'inline_query', 'chosen_inline_result',
  'poll', 'poll_answer', 'pre_checkout_query', 'shipping_query', 'my_chat_member',
] as const;

/** A Map that evicts its oldest entries past `max` — per-chat caches must not grow forever. */
class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly max: number) { super(); }
  override set(key: K, value: V): this {
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    if (this.size > this.max) this.delete(this.keys().next().value as K);
    return this;
  }
}

/** Infer what kind of payload produced an existing message (for edit-vs-send decisions). */
function payloadFromMessage(msg: TgMessage): TelegramSendPayload {
  const method: SendMethod =
    msg.photo ? 'sendPhoto'
    : msg.video ? 'sendVideo'
    : msg.animation ? 'sendAnimation'
    : msg.document ? 'sendDocument'
    : msg.audio ? 'sendAudio'
    : msg.poll ? 'sendPoll'
    : msg.sticker ? 'sendSticker'
    : msg.location ? 'sendLocation'
    : msg.text != null ? 'sendMessage'
    : 'sendPoll'; // unknown kinds are treated as non-editable
  return { method, text: msg.text ?? msg.caption };
}

/**
 * Telegram platform adapter for Teact — framework-agnostic.
 *
 * Rendering, in-place edits, polling, webhooks, callback answering and payments are all
 * implemented here once; the actual HTTP client is a pluggable {@link TelegramDriver}:
 *
 * ```ts
 * new TelegramAdapter()                                  // zero-dep fetch driver
 * new TelegramAdapter({ driver: grammyDriver() })        // grammY
 * new TelegramAdapter({ driver: gramioDriver() })        // GramIO
 * ```
 */
export class TelegramAdapter implements Adapter {
  readonly name = 'telegram';
  readonly driver: TelegramDriver;
  /** The bot's own user, available after `connect()`. */
  me: TgUser | null = null;

  private readonly config: TelegramAdapterConfig;
  private readonly _api: TelegramApi;
  private connected = false;
  private bridged = false;
  private poller: Poller | null = null;
  private server: WebhookServer | null = null;
  private listeners = new Map<string, Set<EventHandler | ((update: TgUpdate) => unknown)>>();
  // A <Notification> rendered in response to a callback query is stashed here (keyed by chat)
  // and flushed as that query's answer once the render finishes.
  private pendingNotifications = new Map<string, { text: string; showAlert?: boolean }>();
  // What we last rendered into each message — drives edit-vs-send and skips no-op edits.
  private rendered = new BoundedMap<string, { payload: TelegramSendPayload; signature: string }>(10_000);

  constructor(config: TelegramAdapterConfig = {}) {
    this.config = config;
    this.driver = config.driver ?? fetchDriver();
    this._api = createTelegramApi((method, params) => this.driver.call(method, params));
  }

  /** Framework-agnostic Bot API access: `adapter.api.sendMessage({ chat_id, text })`. */
  get api(): TelegramApi {
    return this._api;
  }

  /**
   * Register a handler. Engine events receive a `BotContext`: `'message'`, `'callback_query'`,
   * `'event'` (any other chat-bound update). Raw listeners receive the Telegram `Update`:
   * `'update'` (every update) or `'update:<type>'` (e.g. `'update:inline_query'`).
   */
  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  /** Remove a previously registered event handler. */
  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  private async emit(event: string, payload: any): Promise<void> {
    for (const handler of this.listeners.get(event) ?? []) await (handler as any)(payload);
  }

  /** Create the client and fetch the bot's identity. Does not start receiving updates. */
  async connect(config: { token?: string } = {}): Promise<void> {
    if (this.connected) return;
    const token = this.config.token || config.token || undefined;
    this.me = await this.driver.init(token);
    this.connected = true;
  }

  /** Register framework-native middleware (grammY / GramIO drivers only). */
  use(...middleware: unknown[]): void {
    if (!this.driver.use) {
      throw new Error(`[telegram] The "${this.driver.name}" driver doesn't support native middleware. Use grammyDriver() or gramioDriver().`);
    }
    this.driver.use(...middleware);
  }

  /** The underlying client (grammY / GramIO `Bot`), when the driver has one. */
  getBot<T = any>(): T {
    if (!this.driver.native) throw new Error(`[telegram] The "${this.driver.name}" driver has no native bot instance.`);
    return this.driver.native as T;
  }

  /** Wire the driver's update stream into Teact. Idempotent. */
  private bridge(): void {
    if (this.bridged) return;
    if (!this.connected) throw new Error('[telegram] Adapter not connected — call connect() first.');
    this.bridged = true;
    this.driver.onUpdate((update, native) => this.dispatch(update, native));
  }

  /** Process one raw update (also usable directly, e.g. from a custom webhook route). */
  async handleUpdate(update: TgUpdate): Promise<void> {
    this.bridge();
    await this.driver.handleUpdate(update);
  }

  private async dispatch(update: TgUpdate, native?: unknown): Promise<void> {
    const kind = Object.keys(update).find((k) => k !== 'update_id') ?? 'unknown';
    // Raw-update listeners (`adapter.on('update', …)` / `adapter.on('update:inline_query', …)`).
    await this.emit('update', update);
    await this.emit(`update:${kind}`, update);

    if (update.pre_checkout_query) {
      await this.answerPreCheckout(update.pre_checkout_query);
    }

    const ctx = this.mapUpdate(update, kind, native);
    if (!ctx) return;

    if (kind === 'message') {
      await this.emit('message', ctx);
      return;
    }

    if (kind === 'callback_query') {
      const query = update.callback_query!;
      const chatKey = ctx.chatId;
      this.pendingNotifications.delete(chatKey);
      // Remember what the tapped message is, so a fresh root can edit it in place.
      if (query.message) {
        const key = `${chatKey}:${query.message.message_id}`;
        if (!this.rendered.has(key)) {
          this.rendered.set(key, { payload: payloadFromMessage(query.message), signature: '' });
        }
      }
      try {
        // Render first — a <Notification> in the render populates pendingNotifications —
        // then answer with it (toast/alert), or with nothing to stop the button spinner.
        await this.emit('callback_query', ctx);
      } finally {
        const note = this.pendingNotifications.get(chatKey);
        this.pendingNotifications.delete(chatKey);
        await this.driver
          .call('answerCallbackQuery', {
            callback_query_id: query.id,
            ...(note ? { text: note.text, show_alert: note.showAlert } : {}),
          })
          .catch(() => { /* query expired (>15 min) or already answered — nothing to do */ });
      }
      return;
    }

    await this.emit('event', ctx);
  }

  private async answerPreCheckout(query: NonNullable<TgUpdate['pre_checkout_query']>): Promise<void> {
    let verdict: true | string = true;
    try {
      verdict = this.config.onPreCheckout ? await this.config.onPreCheckout(query) : true;
    } catch (err) {
      console.error('[telegram] onPreCheckout threw — declining the payment:', err);
      verdict = 'Payment could not be processed. Please try again.';
    }
    await this.driver
      .call('answerPreCheckoutQuery', {
        pre_checkout_query_id: query.id,
        ok: verdict === true,
        ...(verdict === true ? {} : { error_message: verdict }),
      })
      .catch((err) => console.error('[telegram] answerPreCheckoutQuery failed:', err));
  }

  /** Normalize a raw update into a Teact `BotContext`, or `null` if it has no chat to render into. */
  mapUpdate(update: TgUpdate, kind: string, native?: unknown): BotContext | null {
    const base = { platform: 'telegram', raw: update, api: this._api, native, updateType: kind, botUsername: this.me?.username };
    const toUser = (u?: TgUser) => ({
      id: String(u?.id ?? ''),
      username: u?.username,
      firstName: u?.first_name,
      lastName: u?.last_name,
      isBot: u?.is_bot,
      platform: 'telegram',
    });
    const fromMessage = (msg: TgMessage, from?: TgUser): BotContext => ({
      ...base,
      chatId: String(msg.chat.id),
      userId: String(from?.id ?? msg.from?.id ?? msg.chat.id),
      user: toUser(from ?? msg.from),
      messageId: String(msg.message_id),
      threadId: msg.is_topic_message ? msg.message_thread_id : undefined,
    });

    switch (kind) {
      case 'message':
      case 'edited_message':
      case 'channel_post':
      case 'edited_channel_post': {
        const msg = update[kind] as TgMessage;
        return { ...fromMessage(msg), text: msg.text };
      }
      case 'callback_query': {
        const q = update.callback_query!;
        // Inline-mode buttons (inline_message_id) and game buttons have no chat to render into.
        if (!q.message || q.data == null) return null;
        return { ...fromMessage(q.message, q.from), callbackData: q.data };
      }
      case 'poll_answer': {
        const user = update.poll_answer!.user;
        if (!user) return null;
        return { ...base, chatId: String(user.id), userId: String(user.id), user: toUser(user) };
      }
      case 'pre_checkout_query':
      case 'shipping_query': {
        const from = update[kind]!.from;
        return { ...base, chatId: String(from.id), userId: String(from.id), user: toUser(from) };
      }
      case 'my_chat_member':
      case 'chat_member':
      case 'chat_join_request': {
        const u = update[kind]!;
        return { ...base, chatId: String(u.chat.id), userId: String(u.from.id), user: toUser(u.from) };
      }
      case 'message_reaction': {
        const r = update.message_reaction!;
        return { ...base, chatId: String(r.chat.id), userId: String(r.user?.id ?? r.chat.id), user: toUser(r.user) };
      }
      default:
        return null;
    }
  }

  /**
   * A web-standard webhook handler: `(request: Request) => Promise<Response>`.
   * Deploy anywhere — Cloudflare Workers, Vercel/Deno Edge, Bun.serve, Node.
   */
  webhookCallback(opts: { secretToken?: string } = {}): (request: Request) => Promise<Response> {
    this.bridge();
    return createWebhookHandler((update) => this.driver.handleUpdate(update), opts);
  }

  /** Start receiving updates: long polling (default) or a self-hosted webhook server. */
  async listen(opts: ListenOptions = {}): Promise<void> {
    this.bridge();
    const allowed = this.config.allowedUpdates ?? DEFAULT_ALLOWED_UPDATES;

    if (opts.webhook) {
      const cfg = opts.webhook;
      const port = cfg.port ?? 3000;
      const path = cfg.path ?? '/webhook';
      const url = `${cfg.domain.replace(/\/+$/, '')}${path}`;
      this.server = await serveWebhook(this.webhookCallback({ secretToken: cfg.secretToken }), port, path);
      await this.driver.call('setWebhook', {
        url,
        secret_token: cfg.secretToken,
        allowed_updates: allowed,
        drop_pending_updates: this.config.dropPendingUpdates ?? false,
      });
      console.log(`[telegram] Webhook listening on :${port}${path} → ${url}`);
      return;
    }

    if (opts.polling === false) return;
    this.poller = new Poller(this.driver, (update) => this.driver.handleUpdate(update), {
      allowedUpdates: allowed,
      dropPendingUpdates: this.config.dropPendingUpdates,
      concurrency: this.config.concurrency,
    });
    await this.poller.start();
    console.log(`[telegram] Polling as @${this.me?.username ?? '?'} (driver: ${this.driver.name})`);
  }

  /** Stop polling / the webhook server and release the client. */
  async disconnect(): Promise<void> {
    await this.poller?.stop();
    this.poller = null;
    await this.server?.close();
    this.server = null;
    await this.driver.close?.();
    this.connected = false;
    console.log('[telegram] Disconnected');
  }

  // ---- Rendering ----

  /** What a message *looks like* — identical renders produce identical signatures. */
  private signatureOf(payload: TelegramSendPayload): string {
    const { notification: _n, ...visible } = payload;
    return JSON.stringify(visible);
  }

  private trackNotification(chatId: string | number, payload: TelegramSendPayload): void {
    if (payload.notification) this.pendingNotifications.set(String(chatId), payload.notification);
  }

  /** Send a rendered output tree; resolves to the new message id. */
  async send(chatId: string | number, output: OutputNode, opts: { threadId?: number } = {}): Promise<number | undefined> {
    const payload = serializeOutput(output);
    this.trackNotification(chatId, payload);
    const call = buildSendCall(payload, chatId, opts);
    if (!call) {
      if (payload.method === 'sendMessage' && payload.keyboard?.length) {
        console.warn('[teact] A <Message> has buttons but no text — Telegram requires text to attach a keyboard, so nothing was sent.');
      }
      return undefined;
    }
    const result = await this.driver.call(call.method, call.params);
    const msg = Array.isArray(result) ? result[0] : result;
    const messageId: number | undefined = msg?.message_id;
    if (messageId != null) {
      this.rendered.set(`${chatId}:${messageId}`, { payload, signature: this.signatureOf(payload) });
    }
    return messageId;
  }

  /**
   * Whether `output` can replace message `messageId` in place: text ↔ text, or media ↔ media
   * (photo/video/animation/document/audio via `editMessageMedia`). Reply keyboards, polls,
   * stickers, locations and albums can't be edited — the engine sends a new message instead.
   */
  canEdit(output: OutputNode, chatId?: string | number, messageId?: number): boolean {
    const payload = serializeOutput(output);
    if (payload.replyKeyboard || payload.removeKeyboard) return false;
    const kind = messageKind(payload.method);
    if (kind === 'other') return false;
    if (chatId == null || messageId == null) return kind === 'text';
    const prev = this.rendered.get(`${chatId}:${messageId}`);
    return (prev ? messageKind(prev.payload.method) : 'text') === kind;
  }

  /** Edit an existing message in place. No-op edits are skipped without an API call. */
  async edit(chatId: string | number, messageId: number, output: OutputNode): Promise<void> {
    const payload = serializeOutput(output);
    this.trackNotification(chatId, payload);
    const key = `${chatId}:${messageId}`;
    const prev = this.rendered.get(key);
    const call = buildEditCall(payload, prev?.payload, chatId, messageId);
    if (!call) throw new Error(`[telegram] Can't edit message ${messageId} into a ${payload.method} in place.`);
    const signature = this.signatureOf(payload);
    if (prev?.signature === signature) return;
    try {
      await this.driver.call(call.method, call.params);
    } catch (err) {
      if (!isNotModifiedError(err)) throw err;
    }
    this.rendered.set(key, { payload, signature });
  }

  /** Remove all inline keyboard buttons from a message. */
  async clearButtons(chatId: string | number, messageId: number): Promise<void> {
    try {
      await this.driver.call('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
      const prev = this.rendered.get(`${chatId}:${messageId}`);
      if (prev) this.rendered.set(`${chatId}:${messageId}`, { payload: { ...prev.payload, keyboard: undefined }, signature: '' });
    } catch {
      // Message has no buttons or can't be modified anymore — nothing to clear.
    }
  }

  /** Register bot commands with Telegram's command menu. */
  async setCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.driver.call('setMyCommands', { commands });
  }
}
