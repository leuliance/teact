import type { Adapter, OutputNode } from '@teactjs/core';
import { textMessage } from './utils';

/** A chat to deliver to. */
export type ChatId = string | number;

/** Progress snapshot passed to `onProgress` after each recipient is processed. */
export interface BroadcastProgress {
  /** Recipients processed so far (sent + failed + blocked). */
  processed: number;
  sent: number;
  failed: number;
  blocked: number;
}

/** A delivery that failed for a reason other than the bot being blocked. */
export interface BroadcastFailure {
  chatId: ChatId;
  error: unknown;
}

/** Outcome of {@link Broadcaster.send}. */
export interface BroadcastResult {
  /** Recipients taken from the iterator. */
  total: number;
  sent: number;
  /** Chats where the bot was blocked / kicked / the user is deactivated (HTTP 403). Remove them from your list. */
  blocked: ChatId[];
  /** Other failures (after retries). */
  failed: BroadcastFailure[];
  /** `true` if stopped early via `signal`. */
  aborted: boolean;
  durationMs: number;
}

/** Options for {@link createBroadcaster}. */
export interface BroadcasterOptions {
  /** Adapter used to send (the same one you pass to `createBot`). */
  adapter: Pick<Adapter, 'send'>;
  /** Chats to deliver to — an (async) iterable, so you can stream ids from a DB cursor. */
  recipients: () => AsyncIterable<ChatId> | Iterable<ChatId>;
  /** Max messages per second. Default `25` (Telegram allows ~30/s across chats). */
  rate?: number;
  /** Max sends in flight at once. Default: `rate`. */
  concurrency?: number;
  /** Retries per chat on HTTP 429 (honouring `retry_after`) or transient errors (5xx / network). Default `3`. */
  maxRetries?: number;
  /** Called after each recipient is processed. */
  onProgress?: (progress: BroadcastProgress) => void;
}

/** Per-send options. */
export interface BroadcastSendOptions {
  /** Abort the broadcast; already-started sends finish. */
  signal?: AbortSignal;
}

/** Message to broadcast: text, an output tree, or a per-chat builder (personalization). */
export type BroadcastMessage = string | OutputNode | ((chatId: ChatId) => string | OutputNode | Promise<string | OutputNode>);

/** Returned by {@link createBroadcaster}. */
export interface Broadcaster {
  send(message: BroadcastMessage, opts?: BroadcastSendOptions): Promise<BroadcastResult>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Telegram-style error inspection (works with grammY's `GrammyError` and plain objects). */
function classify(err: unknown): { status?: number; retryAfter?: number } {
  const e = err as any;
  const status: unknown = e?.error_code ?? e?.status ?? e?.statusCode ?? e?.response?.error_code;
  const retryAfter: unknown = e?.parameters?.retry_after ?? e?.retry_after ?? e?.response?.parameters?.retry_after;
  let s = typeof status === 'number' ? status : undefined;
  if (s == null && typeof e?.message === 'string') {
    if (/\b403\b|Forbidden/i.test(e.message)) s = 403;
    else if (/\b429\b|Too Many Requests/i.test(e.message)) s = 429;
  }
  return { status: s, retryAfter: typeof retryAfter === 'number' ? retryAfter : undefined };
}

/**
 * Send one message to many chats (announcements, newsletters) while respecting Telegram's
 * rate limits. Sends are paced to `rate` per second; on HTTP 429 the whole broadcast
 * pauses for `retry_after` and retries. Chats that blocked the bot (HTTP 403) are
 * collected in `result.blocked` instead of failing the run.
 *
 * Run it outside the update pipeline (a command handler, cron job or admin script) — a
 * large broadcast takes `recipients / rate` seconds.
 *
 * @example
 * const broadcaster = createBroadcaster({
 *   adapter,
 *   recipients: async function* () { for await (const u of db.users.cursor()) yield u.chatId; },
 *   onProgress: (p) => console.log(`${p.processed} done`),
 * });
 * const result = await broadcaster.send('📣 New feature is live!');
 * await db.users.markInactive(result.blocked);
 */
export function createBroadcaster(options: BroadcasterOptions): Broadcaster {
  const rate = options.rate ?? 25;
  if (!(rate > 0)) throw new Error('[teact-broadcast] `rate` must be > 0');
  const interval = 1000 / rate;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? rate));
  const maxRetries = options.maxRetries ?? 3;

  return {
    async send(message, opts = {}) {
      const started = Date.now();
      const result: BroadcastResult = { total: 0, sent: 0, blocked: [], failed: [], aborted: false, durationMs: 0 };
      let nextAt = Date.now();

      // Reserve the next send slot (global pacing across concurrent sends).
      const slot = async () => {
        const now = Date.now();
        const at = Math.max(now, nextAt);
        nextAt = at + interval;
        if (at > now) await sleep(at - now);
      };

      const progress = () =>
        options.onProgress?.({
          processed: result.sent + result.failed.length + result.blocked.length,
          sent: result.sent,
          failed: result.failed.length,
          blocked: result.blocked.length,
        });

      const deliver = async (chatId: ChatId) => {
        let attempt = 0;
        for (;;) {
          try {
            const m = typeof message === 'function' ? await message(chatId) : message;
            await options.adapter.send(chatId, typeof m === 'string' ? textMessage(m) : m);
            result.sent++;
            break;
          } catch (error) {
            const { status, retryAfter } = classify(error);
            if (status === 403) { result.blocked.push(chatId); break; }
            const retryable =
              status === 429 || (status != null && status >= 500) || (status == null && isNetworkError(error));
            if (!retryable || attempt >= maxRetries) {
              result.failed.push({ chatId, error });
              break;
            }
            attempt++;
            // Pause everyone: Telegram's flood control is per bot, not per chat.
            const backoff = status === 429 ? (retryAfter ?? 1) * 1000 : 500 * attempt;
            nextAt = Math.max(nextAt, Date.now() + backoff);
            await slot();
            if (opts.signal?.aborted) {
              result.aborted = true;
              result.failed.push({ chatId, error });
              break;
            }
          }
        }
        progress();
      };

      const inflight = new Set<Promise<void>>();
      try {
        for await (const chatId of options.recipients()) {
          if (opts.signal?.aborted) { result.aborted = true; break; }
          result.total++;
          while (inflight.size >= concurrency) await Promise.race(inflight);
          await slot();
          if (opts.signal?.aborted) { result.total--; result.aborted = true; break; }
          const p: Promise<void> = deliver(chatId).finally(() => inflight.delete(p));
          inflight.add(p);
        }
      } finally {
        // Even if `recipients()` throws, let sends already started finish (and be counted).
        await Promise.all(inflight);
      }
      result.durationMs = Date.now() - started;
      return result;
    },
  };
}

function isNetworkError(err: unknown): boolean {
  const e = err as any;
  const name = String(e?.name ?? '');
  const code = String(e?.code ?? '');
  return name === 'HttpError' || name === 'FetchError' || /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|UND_ERR/.test(code);
}
