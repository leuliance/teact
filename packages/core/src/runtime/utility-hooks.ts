import { useCallback, useEffect, useRef } from 'react';
import { useBot, useCommand } from './context';

// ---- useChatAction ----

/** Chat actions Telegram can display ("typing…", "sending photo…", …). */
export type ChatAction =
  | 'typing' | 'upload_photo' | 'record_video' | 'upload_video' | 'record_voice'
  | 'upload_voice' | 'upload_document' | 'choose_sticker' | 'find_location'
  | 'record_video_note' | 'upload_video_note';

/**
 * Show a chat action ("typing…") while slow work runs.
 *
 * - `useChatAction('typing', isLoading)` keeps the indicator alive (Telegram shows it for
 *   ~5s per call, so it's refreshed every 4s) for as long as `active` is true.
 * - The returned function sends a one-off action.
 *
 * @example
 * const q = useQuery({ key: 'report', fn: buildReport });
 * useChatAction('typing', q.isLoading);
 */
export function useChatAction(action: ChatAction = 'typing', active = false): (action?: ChatAction) => Promise<void> {
  const bot = useBot();
  const api = bot.api;
  const chatId = bot.chatId;
  const threadId = bot.threadId;

  const send = useCallback(async (a: ChatAction = action) => {
    if (!api) return;
    await api.call('sendChatAction', {
      chat_id: chatId,
      action: a,
      ...(threadId != null ? { message_thread_id: threadId } : {}),
    }).catch(() => { /* purely cosmetic — never fail the render over it */ });
  }, [api, chatId, threadId, action]);

  useEffect(() => {
    if (!active) return;
    void send();
    const id = setInterval(() => void send(), 4000);
    return () => clearInterval(id);
  }, [active, send]);

  return send;
}

// ---- useInterval ----

/**
 * Run `callback` every `ms` milliseconds; pass `null` to pause. Each state update re-renders
 * (and edits) the message — keep intervals ≥ 1s to stay within Telegram's edit limits.
 *
 * @example
 * const [left, setLeft] = useState(10);
 * useInterval(() => setLeft((s) => s - 1), left > 0 ? 1000 : null);
 * return <Message text={left > 0 ? `⏳ ${left}s` : '🚀 Liftoff!'} />;
 */
export function useInterval(callback: () => void, ms: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => saved.current(), Math.max(ms, 50));
    return () => clearInterval(id);
  }, [ms]);
}

// ---- useDeepLink ----

const PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface DeepLink {
  /** The `/start <payload>` argument that opened the bot, if any. */
  payload: string | undefined;
  /**
   * Build a `t.me` link that opens this bot with a payload (referrals, invites, shared items).
   * Payloads must be 1–64 chars of `A-Z a-z 0-9 _ -`.
   */
  link(payload?: string, opts?: { group?: boolean }): string;
}

/**
 * Read and create deep links (`https://t.me/<bot>?start=<payload>`).
 *
 * @example
 * const { payload, link } = useDeepLink();
 * if (payload?.startsWith('ref_')) creditReferrer(payload.slice(4));
 * return <Message text={`Invite friends: ${link(`ref_${user.id}`)}`} />;
 */
export function useDeepLink(): DeepLink {
  const bot = useBot();
  const command = useCommand();
  const payload = command?.name === 'start' && command.args.length > 0
    ? command.args[0]
    : /^\/start(?:@\S+)?\s+(\S+)/.exec(bot.text ?? '')?.[1];
  return {
    payload,
    link(p, opts) {
      if (!bot.botUsername) throw new Error('[teact] useDeepLink().link() needs the bot username (available once the adapter connected).');
      const base = `https://t.me/${bot.botUsername}`;
      if (p == null) return base;
      if (!PAYLOAD_RE.test(p)) {
        throw new Error(`[teact] Deep-link payload "${p}" is invalid — use 1–64 chars of A-Z a-z 0-9 _ - (base64url-encode other data).`);
      }
      return `${base}?${opts?.group ? 'startgroup' : 'start'}=${p}`;
    },
  };
}
