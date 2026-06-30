import type { OutputNode } from '@teactjs/core';
import type { InlineKeyboardButton as GrammyButton, KeyboardButton } from 'grammy/types';

export type SendMethod =
  | 'sendMessage' | 'sendPhoto' | 'sendDocument'
  | 'sendVideo' | 'sendVoice' | 'sendAudio'
  | 'sendAnimation' | 'sendVideoNote' | 'sendSticker'
  | 'sendContact' | 'sendLocation' | 'sendVenue'
  | 'sendMediaGroup' | 'sendPoll';

export interface MediaGroupItem {
  type: 'photo' | 'video';
  media: string;
  caption?: string;
  parse_mode?: string;
  has_spoiler?: boolean;
  width?: number;
  height?: number;
  duration?: number;
  supports_streaming?: boolean;
}

export interface TelegramSendPayload {
  method: SendMethod;
  text?: string;
  photo?: string;
  document?: string;
  filename?: string;
  parseMode?: string;
  disablePreview?: boolean;
  keyboard?: GrammyButton[][];

  video?: string;
  voice?: string;
  audio?: string;
  animation?: string;
  videoNote?: string;
  sticker?: string;

  width?: number;
  height?: number;
  duration?: number;
  supportsStreaming?: boolean;
  hasSpoiler?: boolean;

  performer?: string;
  title?: string;
  length?: number;
  emoji?: string;

  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  vcard?: string;

  latitude?: number;
  longitude?: number;
  livePeriod?: number;
  horizontalAccuracy?: number;
  heading?: number;
  proximityAlertRadius?: number;

  venueTitle?: string;
  venueAddress?: string;
  foursquareId?: string;
  foursquareType?: string;
  googlePlaceId?: string;
  googlePlaceType?: string;

  mediaGroup?: MediaGroupItem[];

  replyKeyboard?: { rows: KeyboardButton[][]; resizeKeyboard?: boolean; oneTimeKeyboard?: boolean; placeholder?: string; isPersistent?: boolean };
  removeKeyboard?: boolean;
  notification?: { text: string; showAlert?: boolean };

  pollQuestion?: string;
  pollOptions?: string[];
  pollIsAnonymous?: boolean;
  pollType?: 'regular' | 'quiz';
  pollAllowsMultipleAnswers?: boolean;
  pollCorrectOptionId?: number;
  pollExplanation?: string;
  pollExplanationParseMode?: string;
  pollOpenPeriod?: number;
  pollIsClosed?: boolean;
}

export function serializeOutput(node: OutputNode): TelegramSendPayload {
  const result: TelegramSendPayload = { method: 'sendMessage', text: '' };
  walk(node, result);
  return result;
}

function walk(node: OutputNode, out: TelegramSendPayload): void {
  switch (node.type) {
    case 'tg-message': {
      if (node.props.text) out.text = (out.text ?? '') + node.props.text;
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.disablePreview) out.disablePreview = true;
      for (const c of node.children) walk(c, out);
      break;
    }

    case '#text': {
      if (node.props.value) out.text = (out.text ?? '') + node.props.value;
      break;
    }

    case 'tg-bold': {
      out.parseMode = out.parseMode || 'HTML';
      out.text = (out.text ?? '') + '<b>';
      for (const c of node.children) walk(c, out);
      out.text += '</b>';
      break;
    }

    case 'tg-italic': {
      out.parseMode = out.parseMode || 'HTML';
      out.text = (out.text ?? '') + '<i>';
      for (const c of node.children) walk(c, out);
      out.text += '</i>';
      break;
    }

    case 'tg-code': {
      out.parseMode = out.parseMode || 'HTML';
      if (node.props.language) {
        out.text = (out.text ?? '') + `<pre><code class="language-${node.props.language}">`;
        for (const c of node.children) walk(c, out);
        out.text += '</code></pre>';
      } else {
        out.text = (out.text ?? '') + '<code>';
        for (const c of node.children) walk(c, out);
        out.text += '</code>';
      }
      break;
    }

    case 'tg-keyboard': {
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-button-row': {
      if (!out.keyboard) out.keyboard = [];
      const row: GrammyButton[] = [];
      for (const c of node.children) {
        const btn = makeButton(c);
        if (btn) row.push(btn);
      }
      if (row.length > 0) out.keyboard.push(row);
      break;
    }

    case 'tg-button': {
      if (!out.keyboard) out.keyboard = [];
      const btn = makeButton(node);
      if (btn) out.keyboard.push([btn]);
      break;
    }

    case 'tg-photo': {
      out.method = 'sendPhoto';
      out.photo = node.props.src;
      if (node.props.caption) out.text = (out.text ?? '') + node.props.caption;
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.hasSpoiler) out.hasSpoiler = true;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-document': {
      out.method = 'sendDocument';
      out.document = node.props.src;
      if (node.props.caption) out.text = (out.text ?? '') + node.props.caption;
      if (node.props.filename) out.filename = node.props.filename;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-video': {
      out.method = 'sendVideo';
      out.video = node.props.src;
      if (node.props.caption) out.text = (out.text ?? '') + node.props.caption;
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.width) out.width = node.props.width;
      if (node.props.height) out.height = node.props.height;
      if (node.props.duration) out.duration = node.props.duration;
      if (node.props.supportsStreaming) out.supportsStreaming = true;
      if (node.props.hasSpoiler) out.hasSpoiler = true;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-animation': {
      out.method = 'sendAnimation';
      out.animation = node.props.src;
      if (node.props.caption) out.text = (out.text ?? '') + node.props.caption;
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.width) out.width = node.props.width;
      if (node.props.height) out.height = node.props.height;
      if (node.props.duration) out.duration = node.props.duration;
      if (node.props.hasSpoiler) out.hasSpoiler = true;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-voice': {
      out.method = 'sendVoice';
      out.voice = node.props.src;
      if (node.props.caption) out.text = (out.text ?? '') + node.props.caption;
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.duration) out.duration = node.props.duration;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-audio': {
      out.method = 'sendAudio';
      out.audio = node.props.src;
      if (node.props.caption) out.text = (out.text ?? '') + node.props.caption;
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.performer) out.performer = node.props.performer;
      if (node.props.title) out.title = node.props.title;
      if (node.props.duration) out.duration = node.props.duration;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-video-note': {
      out.method = 'sendVideoNote';
      out.videoNote = node.props.src;
      if (node.props.duration) out.duration = node.props.duration;
      if (node.props.length) out.length = node.props.length;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-sticker': {
      out.method = 'sendSticker';
      out.sticker = node.props.src;
      if (node.props.emoji) out.emoji = node.props.emoji;
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-contact': {
      out.method = 'sendContact';
      out.phoneNumber = node.props.phoneNumber;
      out.firstName = node.props.firstName;
      if (node.props.lastName) out.lastName = node.props.lastName;
      if (node.props.vcard) out.vcard = node.props.vcard;
      break;
    }

    case 'tg-location': {
      out.method = 'sendLocation';
      out.latitude = node.props.latitude;
      out.longitude = node.props.longitude;
      if (node.props.livePeriod) out.livePeriod = node.props.livePeriod;
      if (node.props.horizontalAccuracy) out.horizontalAccuracy = node.props.horizontalAccuracy;
      if (node.props.heading) out.heading = node.props.heading;
      if (node.props.proximityAlertRadius) out.proximityAlertRadius = node.props.proximityAlertRadius;
      break;
    }

    case 'tg-venue': {
      out.method = 'sendVenue';
      out.latitude = node.props.latitude;
      out.longitude = node.props.longitude;
      out.venueTitle = node.props.title;
      out.venueAddress = node.props.address;
      if (node.props.foursquareId) out.foursquareId = node.props.foursquareId;
      if (node.props.foursquareType) out.foursquareType = node.props.foursquareType;
      if (node.props.googlePlaceId) out.googlePlaceId = node.props.googlePlaceId;
      if (node.props.googlePlaceType) out.googlePlaceType = node.props.googlePlaceType;
      break;
    }

    case 'tg-media-group': {
      out.method = 'sendMediaGroup';
      if (!out.mediaGroup) out.mediaGroup = [];
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-media-photo': {
      if (!out.mediaGroup) out.mediaGroup = [];
      const item: MediaGroupItem = { type: 'photo', media: node.props.src };
      if (node.props.caption) item.caption = node.props.caption;
      if (node.props.parseMode) item.parse_mode = node.props.parseMode;
      if (node.props.hasSpoiler) item.has_spoiler = true;
      out.mediaGroup.push(item);
      break;
    }

    case 'tg-media-video': {
      if (!out.mediaGroup) out.mediaGroup = [];
      const item: MediaGroupItem = { type: 'video', media: node.props.src };
      if (node.props.caption) item.caption = node.props.caption;
      if (node.props.parseMode) item.parse_mode = node.props.parseMode;
      if (node.props.hasSpoiler) item.has_spoiler = true;
      if (node.props.width) item.width = node.props.width;
      if (node.props.height) item.height = node.props.height;
      if (node.props.duration) item.duration = node.props.duration;
      if (node.props.supportsStreaming) item.supports_streaming = true;
      out.mediaGroup.push(item);
      break;
    }

    case 'tg-reply-keyboard': {
      out.replyKeyboard = {
        rows: [],
        resizeKeyboard: node.props.resizeKeyboard,
        oneTimeKeyboard: node.props.oneTimeKeyboard,
        placeholder: node.props.placeholder,
        isPersistent: node.props.isPersistent,
      };
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-reply-row': {
      if (!out.replyKeyboard) break;
      const row: KeyboardButton[] = [];
      for (const c of node.children) {
        if (c.type === 'tg-reply-button') {
          const btn: KeyboardButton = { text: c.props.text };
          if (c.props.requestContact) (btn as any).request_contact = true;
          if (c.props.requestLocation) (btn as any).request_location = true;
          row.push(btn);
        }
      }
      if (row.length > 0) out.replyKeyboard.rows.push(row);
      break;
    }

    case 'tg-reply-button': {
      if (!out.replyKeyboard) break;
      const btn: KeyboardButton = { text: node.props.text };
      if (node.props.requestContact) (btn as any).request_contact = true;
      if (node.props.requestLocation) (btn as any).request_location = true;
      out.replyKeyboard.rows.push([btn]);
      break;
    }

    case 'tg-reply-keyboard-remove': {
      out.removeKeyboard = true;
      break;
    }

    case 'tg-notification': {
      out.notification = {
        text: node.props.text,
        showAlert: node.props.showAlert,
      };
      break;
    }

    case 'tg-poll': {
      out.method = 'sendPoll';
      out.pollQuestion = node.props.question;
      out.pollOptions = node.props.options;
      if (node.props.isAnonymous != null) out.pollIsAnonymous = node.props.isAnonymous;
      if (node.props.type) out.pollType = node.props.type;
      if (node.props.allowsMultipleAnswers) out.pollAllowsMultipleAnswers = true;
      if (node.props.correctOptionId != null) out.pollCorrectOptionId = node.props.correctOptionId;
      if (node.props.explanation) out.pollExplanation = node.props.explanation;
      if (node.props.explanationParseMode) out.pollExplanationParseMode = node.props.explanationParseMode;
      if (node.props.openPeriod) out.pollOpenPeriod = node.props.openPeriod;
      if (node.props.isClosed) out.pollIsClosed = true;
      break;
    }

    case 'tg-alert': {
      const heading = node.props.heading ?? '';
      out.text = (out.text ?? '') + heading + '\n';
      for (const c of node.children) walk(c, out);
      out.text += '\n';
      break;
    }

    case 'tg-list': {
      const ordered = node.props.ordered === true;
      node.children.forEach((c, i) => {
        const prefix = ordered ? `${i + 1}. ` : '• ';
        out.text = (out.text ?? '') + prefix;
        walk(c, out);
        out.text += '\n';
      });
      break;
    }

    case 'tg-list-item': {
      for (const c of node.children) walk(c, out);
      break;
    }

    case 'tg-divider': {
      out.text = (out.text ?? '') + (node.props.text ?? '────────────────────') + '\n';
      break;
    }

    default: {
      for (const c of node.children) walk(c, out);
    }
  }
}

function makeButton(node: OutputNode): GrammyButton | null {
  if (node.type !== 'tg-button') return null;
  const text = node.props.text;
  if (!text) return null;

  if (node.props.url) {
    return { text, url: node.props.url };
  }

  if (node.props.webAppUrl) {
    return { text, web_app: { url: node.props.webAppUrl } };
  }

  const callbackData = node.props.callbackData ?? text;
  return { text, callback_data: callbackData };
}
