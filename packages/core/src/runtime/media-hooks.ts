import { useCallback, useMemo } from 'react';
import { useBot } from './context';
import type { PlatformApi } from '../renderer';

// ---- useChat ----

/** Aggregated chat information for the current update. */
export interface ChatInfo {
  chatId: string;
  userId: string;
  user: { id: string; username?: string; firstName?: string; lastName?: string; isBot?: boolean };
  messageId?: string;
  text?: string;
  callbackData?: string;
  platform: string;
}

/**
 * Returns aggregated chat info (user, chatId, text, callbackData, etc.) for the current update.
 *
 * @example
 * const { chatId, user, text } = useChat();
 */
export function useChat(): ChatInfo {
  const bot = useBot();
  return {
    chatId: bot.chatId,
    userId: bot.userId,
    user: bot.user,
    messageId: bot.messageId,
    text: bot.text,
    callbackData: bot.callbackData,
    platform: bot.platform,
  };
}

// ---- useTelegram ----

/** Low-level, framework-agnostic access to the platform API and the raw update. */
export interface TelegramAccess {
  /**
   * Bot API caller. Call any method with its native params:
   * `api.sendMessage({ chat_id, text })` or `api.call('sendMessage', { chat_id, text })`.
   * Works the same on every driver (fetch, grammY, GramIO).
   */
  api: PlatformApi;
  /** The raw Telegram `Update` for this render. */
  update: any;
  /** The underlying framework's context (grammY `Context`, GramIO context), if any. */
  native: unknown;
  /** @deprecated Use `native` (framework context) or `update` (raw update). */
  ctx: unknown;
  /** The Telegram chat object of the current update, if any. */
  chat: any;
  /** The Telegram user who triggered the current update, if any. */
  from: any;
  chatId: number;
}

const NO_API: PlatformApi = new Proxy({} as PlatformApi, {
  get(_t, prop) {
    if (prop === 'then') return undefined;
    return () => Promise.reject(new Error(
      `[teact] No platform API available (called "${String(prop)}"). The current adapter didn't provide one.`,
    ));
  },
});

/** Pull the chat / sender out of whatever kind of update this is. */
function updateParts(update: any): { chat: any; from: any } {
  if (!update || typeof update !== 'object') return { chat: undefined, from: undefined };
  for (const value of Object.values(update)) {
    if (value && typeof value === 'object') {
      const v = value as any;
      const chat = v.chat ?? v.message?.chat;
      const from = v.from ?? v.user;
      if (chat || from) return { chat, from };
    }
  }
  return { chat: undefined, from: undefined };
}

/**
 * Returns low-level Telegram API access for advanced use cases.
 *
 * @example
 * const { api, chatId } = useTelegram();
 * await api.sendMessage({ chat_id: chatId, text: 'Hello from the raw API!' });
 * await api.call('setMessageReaction', { chat_id: chatId, message_id: 1, reaction: [{ type: 'emoji', emoji: '👍' }] });
 */
export function useTelegram(): TelegramAccess {
  const bot = useBot();
  const { chat, from } = updateParts(bot.raw);
  return {
    api: bot.api ?? NO_API,
    update: bot.raw,
    native: bot.native,
    ctx: bot.native ?? bot.raw,
    chat,
    from,
    chatId: Number(bot.chatId),
  };
}

/** Send `method` to the current chat (and forum topic). */
function useSender() {
  const bot = useBot();
  const api = bot.api ?? NO_API;
  const chatId = Number(bot.chatId);
  const threadId = bot.threadId;
  return useCallback(
    (method: string, params: Record<string, unknown>) =>
      api.call(method, { chat_id: chatId, ...(threadId != null ? { message_thread_id: threadId } : {}), ...params }),
    [api, chatId, threadId],
  );
}

// ---- useMedia (consolidated senders) ----

/** All media-sender functions, returned together by {@link useMedia}. */
export interface MediaSenders {
  photo: (src: string, opts?: { caption?: string; parse_mode?: string; has_spoiler?: boolean }) => Promise<any>;
  video: (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number; supports_streaming?: boolean }) => Promise<any>;
  animation: (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number }) => Promise<any>;
  audio: (src: string, opts?: { caption?: string; parse_mode?: string; performer?: string; title?: string; duration?: number }) => Promise<any>;
  voice: (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number }) => Promise<any>;
  document: (src: string, opts?: { caption?: string; parse_mode?: string }) => Promise<any>;
  sticker: (src: string, opts?: { emoji?: string }) => Promise<any>;
  location: (latitude: number, longitude: number, opts?: { live_period?: number; horizontal_accuracy?: number; heading?: number; proximity_alert_radius?: number }) => Promise<any>;
  contact: (phoneNumber: string, firstName: string, opts?: { last_name?: string; vcard?: string }) => Promise<any>;
  venue: (latitude: number, longitude: number, title: string, address: string, opts?: { foursquare_id?: string; google_place_id?: string }) => Promise<any>;
  poll: (question: string, options: string[], opts?: { is_anonymous?: boolean; type?: 'regular' | 'quiz'; allows_multiple_answers?: boolean; correct_option_id?: number; explanation?: string; open_period?: number }) => Promise<any>;
}

/**
 * Returns every media-sender in one object — the consolidated alternative to the
 * individual `usePhoto`/`useVideo`/… hooks.
 *
 * @example
 * const media = useMedia();
 * await media.photo('https://example.com/cat.jpg', { caption: 'A cat' });
 * await media.poll('Favorite color?', ['Red', 'Blue']);
 */
export function useMedia(): MediaSenders {
  const send = useSender();
  return useMemo<MediaSenders>(() => ({
    photo: (photo, opts) => send('sendPhoto', { photo, ...opts }),
    video: (video, opts) => send('sendVideo', { video, ...opts }),
    animation: (animation, opts) => send('sendAnimation', { animation, ...opts }),
    audio: (audio, opts) => send('sendAudio', { audio, ...opts }),
    voice: (voice, opts) => send('sendVoice', { voice, ...opts }),
    document: (document, opts) => send('sendDocument', { document, ...opts }),
    sticker: (sticker, opts) => send('sendSticker', { sticker, ...opts }),
    location: (latitude, longitude, opts) => send('sendLocation', { latitude, longitude, ...opts }),
    contact: (phone_number, first_name, opts) => send('sendContact', { phone_number, first_name, ...opts }),
    venue: (latitude, longitude, title, address, opts) => send('sendVenue', { latitude, longitude, title, address, ...opts }),
    poll: (question, options, opts) => send('sendPoll', { question, options: options.map((text) => ({ text })), ...opts }),
  }), [send]);
}

// ---- Media send hooks (individual; or use useMedia() for all at once) ----

/**
 * Returns a callback to send a photo to the current chat.
 *
 * @example
 * const sendPhoto = usePhoto();
 * await sendPhoto('https://example.com/cat.jpg', { caption: 'A cute cat' });
 */
export function usePhoto() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; has_spoiler?: boolean }) =>
      media.photo(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send a video to the current chat.
 *
 * @example
 * const sendVideo = useVideo();
 * await sendVideo('https://example.com/clip.mp4', { caption: 'Watch this' });
 */
export function useVideo() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number; supports_streaming?: boolean }) =>
      media.video(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send a GIF/animation to the current chat.
 *
 * @example
 * const sendGif = useAnimation();
 * await sendGif('https://example.com/funny.gif');
 */
export function useAnimation() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number }) =>
      media.animation(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send an audio file to the current chat.
 *
 * @example
 * const sendAudio = useAudio();
 * await sendAudio('https://example.com/song.mp3', { title: 'My Song' });
 */
export function useAudio() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; performer?: string; title?: string; duration?: number }) =>
      media.audio(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send a voice message to the current chat.
 *
 * @example
 * const sendVoice = useVoice();
 * await sendVoice('https://example.com/voice.ogg');
 */
export function useVoice() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number }) =>
      media.voice(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send a document/file to the current chat.
 *
 * @example
 * const sendDoc = useDocument();
 * await sendDoc('https://example.com/report.pdf', { caption: 'Monthly report' });
 */
export function useDocument() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string }) =>
      media.document(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send a sticker to the current chat.
 *
 * @example
 * const sendSticker = useSticker();
 * await sendSticker('CAACAgIAAxkB...');
 */
export function useSticker() {
  const media = useMedia();
  return useCallback(
    (src: string, opts?: { emoji?: string }) =>
      media.sticker(src, opts),
    [media],
  );
}

/**
 * Returns a callback to send a location to the current chat.
 *
 * @example
 * const sendLocation = useLocation();
 * await sendLocation(9.0192, 38.7525);
 */
export function useLocation() {
  const media = useMedia();
  return useCallback(
    (latitude: number, longitude: number, opts?: { live_period?: number; horizontal_accuracy?: number; heading?: number; proximity_alert_radius?: number }) =>
      media.location(latitude, longitude, opts),
    [media],
  );
}

/**
 * Returns a callback to send a contact card to the current chat.
 *
 * @example
 * const sendContact = useContact();
 * await sendContact('+1234567890', 'Jane');
 */
export function useContact() {
  const media = useMedia();
  return useCallback(
    (phoneNumber: string, firstName: string, opts?: { last_name?: string; vcard?: string }) =>
      media.contact(phoneNumber, firstName, opts),
    [media],
  );
}

/**
 * Returns a callback to send a venue to the current chat.
 *
 * @example
 * const sendVenue = useVenue();
 * await sendVenue(9.0192, 38.7525, 'Meskel Square', 'Addis Ababa');
 */
export function useVenue() {
  const media = useMedia();
  return useCallback(
    (latitude: number, longitude: number, title: string, address: string, opts?: { foursquare_id?: string; google_place_id?: string }) =>
      media.venue(latitude, longitude, title, address, opts),
    [media],
  );
}

/**
 * Returns a callback to send a poll to the current chat.
 *
 * @example
 * const sendPoll = usePoll();
 * await sendPoll('Favorite color?', ['Red', 'Blue', 'Green']);
 */
export function usePoll() {
  const media = useMedia();
  return useCallback(
    (question: string, options: string[], opts?: { is_anonymous?: boolean; type?: 'regular' | 'quiz'; allows_multiple_answers?: boolean; correct_option_id?: number; explanation?: string; open_period?: number }) =>
      media.poll(question, options, opts),
    [media],
  );
}
