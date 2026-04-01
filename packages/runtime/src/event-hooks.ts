import { useEffect, useRef, useContext } from 'react';
import { useBot } from './context';
import { RouterCtx, type NavigateOptions } from './router';

/**
 * Telegram update event types supported by `useOn` and `useEventData`.
 * Use `'*'` to match all events.
 */
export type TelegramEvent =
  | '*'
  | 'message' | 'text' | 'photo' | 'video' | 'audio' | 'voice'
  | 'document' | 'sticker' | 'contact' | 'location' | 'venue'
  | 'animation' | 'video_note' | 'poll' | 'poll_answer'
  | 'callback_query' | 'inline_query'
  | 'new_chat_members' | 'left_chat_member'
  | 'dice' | 'game' | 'web_app_data'
  | 'successful_payment' | 'pre_checkout_query';

/** Context object passed to `useOn` handlers with navigation and reply helpers. */
export interface EventContext {
  navigate: (path: string, opts?: NavigateOptions) => void;
  chatId: string;
  userId: string;
  user: { id: string; username?: string; firstName?: string };
  reply: (text: string) => Promise<void>;
  raw: any;
}

type EventHandler = (data: any, ctx: EventContext) => void;

function extractEventData(event: TelegramEvent, raw: any): any {
  const msg = raw?.message;
  switch (event) {
    case 'message':          return msg ?? null;
    case 'text':             return msg?.text ? msg : null;
    case 'photo':            return msg?.photo ?? null;
    case 'video':            return msg?.video ?? null;
    case 'audio':            return msg?.audio ?? null;
    case 'voice':            return msg?.voice ?? null;
    case 'document':         return msg?.document ?? null;
    case 'sticker':          return msg?.sticker ?? null;
    case 'contact':          return msg?.contact ?? null;
    case 'location':         return msg?.location ?? null;
    case 'venue':            return msg?.venue ?? null;
    case 'animation':        return msg?.animation ?? null;
    case 'video_note':       return msg?.video_note ?? null;
    case 'poll':             return msg?.poll ?? raw?.poll ?? null;
    case 'poll_answer':      return raw?.poll_answer ?? null;
    case 'callback_query':   return raw?.callbackQuery ?? null;
    case 'inline_query':     return raw?.inlineQuery ?? null;
    case 'new_chat_members': return msg?.new_chat_members ?? null;
    case 'left_chat_member': return msg?.left_chat_member ?? null;
    case 'dice':             return msg?.dice ?? null;
    case 'game':             return msg?.game ?? null;
    case 'web_app_data':         return msg?.web_app_data ?? null;
    case 'successful_payment':   return msg?.successful_payment ?? null;
    case 'pre_checkout_query':   return raw?.preCheckoutQuery ?? raw?.update?.pre_checkout_query ?? null;
    default:                     return null;
  }
}

/**
 * Listen for a specific Telegram event type within a React component.
 * The handler fires once per matching update and receives an `EventContext`
 * with `navigate`, `reply`, and user info.
 *
 * @example
 * useOn('callback_query', (data, ctx) => {
 *   console.log('Callback from', ctx.user.firstName);
 *   ctx.navigate('/details');
 * });
 *
 * useOn('contact', (contact, ctx) => {
 *   ctx.reply(`Got your number: ${contact.phone_number}`);
 * });
 */
export function useOn(event: TelegramEvent, handler: EventHandler): void {
  const bot = useBot();
  const routerCtx = useContext(RouterCtx);
  const raw = bot.raw;
  const handlerRef = useRef<EventHandler>(handler);
  handlerRef.current = handler;
  const lastProcessedRef = useRef<string | null>(null);
  const navigateRef = useRef(routerCtx?.navigate ?? (() => {}));
  navigateRef.current = routerCtx?.navigate ?? (() => {});

  useEffect(() => {
    if (!raw) return;
    const updateId = raw.update?.update_id ?? raw.message?.message_id ?? raw.callbackQuery?.id;
    if (!updateId) return;
    const key = `${event}:${updateId}`;
    if (lastProcessedRef.current === key) return;

    const ctx: EventContext = {
      navigate: navigateRef.current,
      chatId: bot.chatId,
      userId: bot.userId,
      user: bot.user,
      reply: async (text: string) => { await raw.reply?.(text); },
      raw,
    };

    if (event === '*') {
      lastProcessedRef.current = key;
      handlerRef.current(raw, ctx);
      return;
    }

    const data = extractEventData(event, raw);
    if (data) {
      lastProcessedRef.current = key;
      handlerRef.current(data, ctx);
    }
  }, [raw, event]);
}

/**
 * Returns data from the current update if it matches the event, otherwise null.
 * A declarative alternative to `useOn` — read the value instead of registering a callback.
 *
 * @example
 * const contact = useEventData('contact');
 * if (contact) {
 *   return <Message text={`Got your number: ${contact.phone_number}`} />;
 * }
 */
export function useEventData<T = any>(event: TelegramEvent): T | null {
  const bot = useBot();
  const raw = bot.raw;
  if (!raw) return null;
  return extractEventData(event, raw) as T | null;
}
