import type { Adapter, BotContext, OutputNode } from '@teactjs/core';
import type { AnyStorageDriver, AsyncStorageDriver } from '@teactjs/storage';

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/** Send a text or a pre-built output tree to the current chat. */
export type ReplyFn = (message: string | OutputNode) => Promise<void>;

/**
 * What a plugin should do when it blocks/notifies:
 * - a `string` — sent as a plain text message,
 * - an `OutputNode` — sent as-is (e.g. a message with buttons),
 * - a function — full control; receives the update context and a `reply` helper.
 */
export type Reply =
  | string
  | OutputNode
  | ((ctx: BotContext, reply: ReplyFn) => void | Promise<void>);

/** Build a plain `tg-message` output node from text. */
export function textMessage(text: string): OutputNode {
  return { type: 'tg-message', props: { text }, children: [] };
}

function toChatId(id: string): string | number {
  return /^-?\d+$/.test(id) ? Number(id) : id;
}

/** Holds the adapter captured in a plugin's `onStart`, and sends replies through it. */
export class AdapterRef {
  adapter: Adapter | undefined;

  reply(ctx: BotContext): ReplyFn {
    return async (message) => {
      if (!this.adapter) return;
      const node = typeof message === 'string' ? textMessage(message) : message;
      await this.adapter.send(toChatId(ctx.chatId), node);
    };
  }

  /** Deliver a {@link Reply}. Failures are logged, never thrown into the pipeline. */
  async send(ctx: BotContext, r: Reply | undefined, label: string): Promise<void> {
    if (r == null) return;
    try {
      const reply = this.reply(ctx);
      if (typeof r === 'function') await r(ctx, reply);
      else await reply(r);
    } catch (err) {
      console.error(`[${label}] failed to send notification:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Update inspection (works with the Telegram adapter's grammY ctx in `ctx.raw`)
// ---------------------------------------------------------------------------

/** Telegram chat types. */
export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

/** High-level kind of an update. */
export type UpdateKind = 'message' | 'command' | 'callback_query';

export function updateKind(ctx: BotContext): UpdateKind {
  if (ctx.callbackData != null) return 'callback_query';
  if (ctx.text?.startsWith('/')) return 'command';
  return 'message';
}

/** Command name (lowercase, without `/` and `@bot`), if the update is a command. */
export function commandName(ctx: BotContext): string | undefined {
  if (!ctx.text?.startsWith('/')) return undefined;
  const name = ctx.text.slice(1).split(/\s+/)[0].split('@')[0].toLowerCase();
  return name || undefined;
}

/** Underlying message object of the raw update, if any. */
function rawMessage(raw: any): any {
  if (!raw || typeof raw !== 'object') return undefined;
  return (
    raw.msg ??
    raw.message ??
    raw.editedMessage ??
    raw.channelPost ??
    raw.update?.message ??
    raw.update?.edited_message ??
    raw.update?.channel_post ??
    raw.callbackQuery?.message ??
    raw.update?.callback_query?.message
  );
}

/**
 * The chat type of an update. Reads `raw.chat.type` (grammY), the raw message's chat,
 * and falls back to `'private'` when `chatId === userId` (true for Telegram DMs).
 */
export function chatTypeOf(ctx: BotContext): ChatType | undefined {
  const raw = ctx.raw as any;
  const type = raw?.chat?.type ?? rawMessage(raw)?.chat?.type;
  if (type) return type as ChatType;
  if (ctx.chatId && ctx.chatId === ctx.userId) return 'private';
  return undefined;
}

/**
 * Unix timestamp (seconds) at which the update's message was sent, or `undefined`
 * when the update carries no date (e.g. callback queries).
 */
export function updateDateOf(ctx: BotContext): number | undefined {
  if (ctx.callbackData != null) return undefined;
  const raw = ctx.raw as any;
  const date = raw?.date ?? rawMessage(raw)?.date;
  return typeof date === 'number' ? date : undefined;
}

/** Normalize a list of ids (numbers or strings) to a string set. */
export function idSet(ids: ReadonlyArray<string | number> | undefined): Set<string> | undefined {
  return ids ? new Set(ids.map(String)) : undefined;
}

// ---------------------------------------------------------------------------
// Key/value store over an optional @teactjs/storage driver
// ---------------------------------------------------------------------------

/** Minimal async KV with TTL used by stateful plugins. */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  /**
   * Add 1 to a counter and return the new value. `ttlMs` applies when the counter is
   * created. Atomic across instances when the driver implements `incr` (Redis, Postgres,
   * SQLite, D1, MongoDB); otherwise serialized within this process only.
   */
  incr(key: string, ttlMs?: number): Promise<number>;
  /** Whether {@link KV.incr} is atomic across processes. */
  readonly atomic: boolean;
}

interface Entry<T> { v: T; e?: number }

function isAsync(d: AnyStorageDriver): d is AsyncStorageDriver {
  return (d as { async?: unknown }).async === true;
}

/**
 * Wrap a storage driver (sync or async) into a {@link KV}. Values are stored as
 * `{ v, e }` envelopes so TTL works even on drivers without native expiry.
 * Without a driver, an in-process Map is used.
 */
export function createKV(driver: AnyStorageDriver | undefined, prefix: string): KV {
  if (!driver) return memoryKV(prefix);
  const d = driver;
  const lock = new KeyedMutex();
  const kv: KV = {
    atomic: isAsync(d) && typeof d.incr === 'function',
    async incr(key: string, ttlMs?: number) {
      if (isAsync(d) && d.incr) return d.incr(prefix + key, 1, ttlMs ? { ttl: ttlMs } : undefined);
      return lock.run(key, async () => {
        const next = ((await kv.get<number>(key)) ?? 0) + 1;
        const k = prefix + key;
        const existing = (isAsync(d) ? await d.get<Entry<number>>(k) : d.get<Entry<number>>(k)) as Entry<number> | number | undefined;
        // Keep the original expiry of an existing counter.
        const e = existing && typeof existing === 'object' ? existing.e : ttlMs ? Date.now() + ttlMs : undefined;
        const entry: Entry<number> = e != null ? { v: next, e } : { v: next };
        const ttl = e != null ? Math.max(1, e - Date.now()) : undefined;
        if (isAsync(d)) await d.set(k, entry, ttl ? { ttl } : undefined);
        else d.set(k, entry);
        return next;
      });
    },
    async get<T>(key: string) {
      const k = prefix + key;
      const entry = (await d.get<Entry<T>>(k)) as Entry<T> | undefined;
      // Counters written by a driver's native incr() are plain numbers.
      if (typeof entry === 'number') return entry as T;
      if (!entry || typeof entry !== 'object') return undefined;
      if (entry.e != null && entry.e <= Date.now()) {
        await d.delete(k);
        return undefined;
      }
      return entry.v;
    },
    async set<T>(key: string, value: T, ttlMs?: number) {
      const k = prefix + key;
      const entry: Entry<T> = ttlMs ? { v: value, e: Date.now() + ttlMs } : { v: value };
      if (isAsync(d)) await d.set(k, entry, ttlMs ? { ttl: ttlMs } : undefined);
      else d.set(k, entry);
    },
  };
  return kv;
}

function memoryKV(prefix: string): KV {
  const map = new Map<string, Entry<unknown>>();
  let writes = 0;
  const sweep = () => {
    const now = Date.now();
    for (const [k, e] of map) if (e.e != null && e.e <= now) map.delete(k);
  };
  return {
    atomic: false,
    async incr(key: string, ttlMs?: number) {
      const now = Date.now();
      const k = prefix + key;
      const entry = map.get(k);
      const live = entry && (entry.e == null || entry.e > now) ? entry : undefined;
      const next = ((live?.v as number | undefined) ?? 0) + 1;
      map.set(k, { v: next, e: live ? live.e : ttlMs ? now + ttlMs : undefined });
      return next;
    },
    async get<T>(key: string) {
      const entry = map.get(prefix + key);
      if (!entry) return undefined;
      if (entry.e != null && entry.e <= Date.now()) {
        map.delete(prefix + key);
        return undefined;
      }
      return entry.v as T;
    },
    async set<T>(key: string, value: T, ttlMs?: number) {
      if (++writes % 1000 === 0) sweep();
      map.set(prefix + key, ttlMs ? { v: value, e: Date.now() + ttlMs } : { v: value });
    },
  };
}

/**
 * Per-key in-process lock, so read-modify-write sequences on the KV don't race
 * between concurrent updates (different chats are processed concurrently).
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    const tail = result.catch(() => {});
    this.tails.set(key, tail);
    tail.finally(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
