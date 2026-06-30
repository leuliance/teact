import { useCallback } from 'react';
import { useBot, useChatId } from './context';

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

/** Low-level access to the grammY API, context, chat, and sender objects. */
export interface TelegramAccess {
  api: any;
  ctx: any;
  chat: any;
  from: any;
  chatId: number;
}

/**
 * Returns low-level Telegram API access for advanced use cases.
 *
 * @example
 * const { api, chatId } = useTelegram();
 * await api.sendMessage(chatId, 'Hello from raw API!');
 */
export function useTelegram(): TelegramAccess {
  const bot = useBot();
  const raw = bot.raw;
  return {
    api: raw?.api,
    ctx: raw,
    chat: raw?.chat,
    from: raw?.from,
    chatId: Number(bot.chatId),
  };
}

// ---- Media send hooks ----

/**
 * Returns a callback to send a photo to the current chat.
 *
 * @example
 * const sendPhoto = usePhoto();
 * await sendPhoto('https://example.com/cat.jpg', { caption: 'A cute cat' });
 */
export function usePhoto() {
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; has_spoiler?: boolean }) =>
      api?.sendPhoto(chatId, src, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number; supports_streaming?: boolean }) =>
      api?.sendVideo(chatId, src, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number; width?: number; height?: number }) =>
      api?.sendAnimation(chatId, src, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; performer?: string; title?: string; duration?: number }) =>
      api?.sendAudio(chatId, src, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { caption?: string; parse_mode?: string; duration?: number }) =>
      api?.sendVoice(chatId, src, opts) as Promise<any>,
    [api, chatId],
  );
}

/**
 * Returns a callback to send a document/file to the current chat.
 *
 * @example
 * const sendDoc = useDocument();
 * await sendDoc('https://example.com/report.pdf', { filename: 'report.pdf' });
 */
export function useDocument() {
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { caption?: string; filename?: string }) =>
      api?.sendDocument(chatId, src, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (src: string, opts?: { emoji?: string }) =>
      api?.sendSticker(chatId, src, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (latitude: number, longitude: number, opts?: { live_period?: number; horizontal_accuracy?: number; heading?: number; proximity_alert_radius?: number }) =>
      api?.sendLocation(chatId, latitude, longitude, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (phoneNumber: string, firstName: string, opts?: { last_name?: string; vcard?: string }) =>
      api?.sendContact(chatId, phoneNumber, firstName, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (latitude: number, longitude: number, title: string, address: string, opts?: { foursquare_id?: string; google_place_id?: string }) =>
      api?.sendVenue(chatId, latitude, longitude, title, address, opts) as Promise<any>,
    [api, chatId],
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
  const { api, chatId } = useTelegram();
  return useCallback(
    (question: string, options: string[], opts?: { is_anonymous?: boolean; type?: 'regular' | 'quiz'; allows_multiple_answers?: boolean; correct_option_id?: number; explanation?: string; open_period?: number }) => {
      const pollOptions = options.map(text => ({ text }));
      return api?.sendPoll(chatId, question, pollOptions, opts) as Promise<any>;
    },
    [api, chatId],
  );
}
