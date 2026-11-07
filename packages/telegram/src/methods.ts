import { stripUndefined } from './api';
import type { SendMethod, TelegramSendPayload } from './serialize';

/** A concrete Bot API call: method name + native params. */
export interface ApiCall {
  method: string;
  params: Record<string, unknown>;
}

/** Media kinds that `editMessageMedia` can swap between in place. */
const EDITABLE_MEDIA: Partial<Record<SendMethod, 'photo' | 'video' | 'animation' | 'document' | 'audio'>> = {
  sendPhoto: 'photo',
  sendVideo: 'video',
  sendAnimation: 'animation',
  sendDocument: 'document',
  sendAudio: 'audio',
};

/** The "kind" of message a payload produces, for edit compatibility checks. */
export type MessageKind = 'text' | 'media' | 'other';

export function messageKind(method: SendMethod): MessageKind {
  if (method === 'sendMessage') return 'text';
  if (EDITABLE_MEDIA[method]) return 'media';
  return 'other';
}

/** The media file reference (URL / file_id) carried by a media payload. */
export function mediaSource(p: TelegramSendPayload): string | undefined {
  switch (p.method) {
    case 'sendPhoto': return p.photo;
    case 'sendVideo': return p.video;
    case 'sendAnimation': return p.animation;
    case 'sendDocument': return p.document;
    case 'sendAudio': return p.audio;
    default: return undefined;
  }
}

function replyMarkup(p: TelegramSendPayload): Record<string, unknown> | undefined {
  if (p.removeKeyboard) return { remove_keyboard: true };
  if (p.replyKeyboard) {
    return stripUndefined({
      keyboard: p.replyKeyboard.rows,
      resize_keyboard: p.replyKeyboard.resizeKeyboard ?? true,
      one_time_keyboard: p.replyKeyboard.oneTimeKeyboard,
      input_field_placeholder: p.replyKeyboard.placeholder,
      is_persistent: p.replyKeyboard.isPersistent,
    });
  }
  if (p.keyboard?.length) return { inline_keyboard: p.keyboard };
  return undefined;
}

/** Only inline keyboards can be attached to an edit; empty array clears old buttons. */
function inlineMarkup(p: TelegramSendPayload): { inline_keyboard: unknown[] } {
  return { inline_keyboard: p.keyboard ?? [] };
}

function caption(p: TelegramSendPayload) {
  return { caption: p.text || undefined, parse_mode: p.text ? p.parseMode : undefined };
}

/**
 * Translate a serialized payload into the Bot API `send*` call that delivers it.
 * Returns `null` when there is nothing sendable (e.g. an empty message).
 */
export function buildSendCall(
  p: TelegramSendPayload,
  chatId: string | number,
  extra: { threadId?: number } = {},
): ApiCall | null {
  const base = { chat_id: chatId, message_thread_id: extra.threadId };
  const reply_markup = replyMarkup(p);

  switch (p.method) {
    case 'sendPhoto':
      return { method: p.method, params: { ...base, photo: p.photo, ...caption(p), has_spoiler: p.hasSpoiler || undefined, reply_markup } };
    case 'sendDocument':
      return { method: p.method, params: { ...base, document: p.document, ...caption(p), reply_markup } };
    case 'sendVideo':
      return {
        method: p.method,
        params: {
          ...base, video: p.video, ...caption(p),
          width: p.width, height: p.height, duration: p.duration,
          supports_streaming: p.supportsStreaming || undefined, has_spoiler: p.hasSpoiler || undefined,
          reply_markup,
        },
      };
    case 'sendAnimation':
      return {
        method: p.method,
        params: {
          ...base, animation: p.animation, ...caption(p),
          width: p.width, height: p.height, duration: p.duration, has_spoiler: p.hasSpoiler || undefined,
          reply_markup,
        },
      };
    case 'sendVoice':
      return { method: p.method, params: { ...base, voice: p.voice, ...caption(p), duration: p.duration, reply_markup } };
    case 'sendAudio':
      return {
        method: p.method,
        params: { ...base, audio: p.audio, ...caption(p), performer: p.performer, title: p.title, duration: p.duration, reply_markup },
      };
    case 'sendVideoNote':
      return { method: p.method, params: { ...base, video_note: p.videoNote, duration: p.duration, length: p.length, reply_markup } };
    case 'sendSticker':
      return { method: p.method, params: { ...base, sticker: p.sticker, emoji: p.emoji, reply_markup } };
    case 'sendContact':
      return {
        method: p.method,
        params: { ...base, phone_number: p.phoneNumber, first_name: p.firstName, last_name: p.lastName, vcard: p.vcard, reply_markup },
      };
    case 'sendLocation':
      return {
        method: p.method,
        params: {
          ...base, latitude: p.latitude, longitude: p.longitude,
          live_period: p.livePeriod, horizontal_accuracy: p.horizontalAccuracy,
          heading: p.heading, proximity_alert_radius: p.proximityAlertRadius,
          reply_markup,
        },
      };
    case 'sendVenue':
      return {
        method: p.method,
        params: {
          ...base, latitude: p.latitude, longitude: p.longitude,
          title: p.venueTitle, address: p.venueAddress,
          foursquare_id: p.foursquareId, foursquare_type: p.foursquareType,
          google_place_id: p.googlePlaceId, google_place_type: p.googlePlaceType,
          reply_markup,
        },
      };
    case 'sendMediaGroup':
      // Media groups can't carry a keyboard at all (Telegram limitation).
      if (!p.mediaGroup?.length) return null;
      return { method: p.method, params: { ...base, media: p.mediaGroup } };
    case 'sendPoll':
      return {
        method: p.method,
        params: {
          ...base,
          question: p.pollQuestion,
          options: (p.pollOptions ?? []).map((text) => ({ text })),
          is_anonymous: p.pollIsAnonymous,
          type: p.pollType,
          allows_multiple_answers: p.pollAllowsMultipleAnswers || undefined,
          correct_option_id: p.pollCorrectOptionId,
          explanation: p.pollExplanation,
          explanation_parse_mode: p.pollExplanationParseMode,
          open_period: p.pollOpenPeriod,
          is_closed: p.pollIsClosed || undefined,
          reply_markup,
        },
      };
    default: {
      const text = p.text?.trim();
      if (!text) return null;
      return {
        method: 'sendMessage',
        params: {
          ...base, text, parse_mode: p.parseMode,
          link_preview_options: p.disablePreview ? { is_disabled: true } : undefined,
          reply_markup,
        },
      };
    }
  }
}

/**
 * Translate a payload into the call that edits message `messageId` in place, given the
 * previous payload rendered into that message. Returns `null` if no in-place edit exists
 * (text ↔ media, polls, stickers, reply keyboards, …) — the caller should send instead.
 */
export function buildEditCall(
  p: TelegramSendPayload,
  prev: TelegramSendPayload | undefined,
  chatId: string | number,
  messageId: number,
): ApiCall | null {
  if (p.replyKeyboard || p.removeKeyboard) return null;
  const kind = messageKind(p.method);
  const prevKind = prev ? messageKind(prev.method) : 'text';
  if (kind !== prevKind) return null;
  const target = { chat_id: chatId, message_id: messageId };

  if (kind === 'text') {
    const text = p.text?.trim();
    if (!text) return null;
    return {
      method: 'editMessageText',
      params: {
        ...target, text, parse_mode: p.parseMode,
        link_preview_options: p.disablePreview ? { is_disabled: true } : undefined,
        reply_markup: inlineMarkup(p),
      },
    };
  }

  if (kind === 'media') {
    const src = mediaSource(p);
    // Same file → only the caption/buttons changed: the cheaper editMessageCaption.
    if (prev && prev.method === p.method && mediaSource(prev) === src && !!prev.hasSpoiler === !!p.hasSpoiler) {
      return {
        method: 'editMessageCaption',
        params: { ...target, caption: p.text ?? '', parse_mode: p.text ? p.parseMode : undefined, reply_markup: inlineMarkup(p) },
      };
    }
    const type = EDITABLE_MEDIA[p.method]!;
    return {
      method: 'editMessageMedia',
      params: {
        ...target,
        media: stripUndefined({
          type,
          media: src,
          caption: p.text || undefined,
          parse_mode: p.text ? p.parseMode : undefined,
          has_spoiler: p.hasSpoiler || undefined,
          width: p.width, height: p.height, duration: p.duration,
          supports_streaming: p.supportsStreaming || undefined,
          performer: p.performer, title: p.title,
        }),
        reply_markup: inlineMarkup(p),
      },
    };
  }

  return null;
}
