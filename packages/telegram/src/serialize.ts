import type { OutputNode } from '@teactjs/core';
import type { InlineKeyboardButton, KeyboardButton } from './types';

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
  keyboard?: InlineKeyboardButton[][];

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

/** Telegram's hard limits — exceeding them is a 400 error, so we clamp defensively. */
const MAX_MESSAGE_LEN = 4096;
const MAX_CAPTION_LEN = 1024;

/**
 * A piece of accumulated text: `literal` = user content (escaped in HTML mode); otherwise
 * it's text we emit ourselves — `tag` marks HTML markup (invisible once Telegram parses it).
 */
interface TextSegment {
  text: string;
  literal: boolean;
  tag?: boolean;
}

/** Escape the five HTML entities Telegram's HTML parse mode cares about. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function hasExplicitParseMode(node: OutputNode): boolean {
  if (node.props?.parseMode) return true;
  return node.children.some(hasExplicitParseMode);
}

function truncate(s: string, max: number, what: string): string {
  if (s.length <= max) return s;
  console.warn(`[teact] ${what} exceeds Telegram's ${max}-char limit (${s.length}); truncating.`);
  return s.slice(0, max - 1) + '…';
}

export function serializeOutput(node: OutputNode): TelegramSendPayload {
  const result: TelegramSendPayload = { method: 'sendMessage', text: '' };
  const segments: TextSegment[] = [];
  walk(node, result, segments);
  // HTML chosen implicitly by <Bold>/<Italic>/<Code> (rather than by the user's parseMode).
  const autoHtml = segments.some((s) => s.tag) && !hasExplicitParseMode(node);

  // Assemble text now that the final parse mode is known. In HTML mode we escape the
  // literal (user-supplied) segments so `<`, `>`, `&` in user content can't break the
  // markup or inject tags; the tags we generated pass through untouched. When the user
  // explicitly set a parse mode on the node, their own text is left verbatim (their
  // responsibility) — only formatting-component children are escaped.
  const isHtml = result.parseMode === 'HTML';
  const isCaption = result.method !== 'sendMessage' && result.method !== 'sendPoll';
  const max = isCaption ? MAX_CAPTION_LEN : MAX_MESSAGE_LEN;
  const what = isCaption ? 'Caption' : 'Message text';

  // Telegram's limits count the *visible* text (after entity parsing), so markup tags we
  // generated don't count. If the visible text is too long, we must not cut through an
  // HTML tag (that would produce invalid markup and a hard 400) — instead drop our
  // generated formatting and send truncated plain text.
  const visibleLen = segments.reduce((n, s) => n + (s.tag ? 0 : s.text.length), 0);
  if (visibleLen > max && autoHtml && isHtml) {
    result.parseMode = undefined;
    result.text = truncate(segments.filter((s) => !s.tag).map((s) => s.text).join(''), max, what);
  } else {
    result.text = segments
      .map((s) => (isHtml && s.literal ? escapeHtml(s.text) : s.text))
      .join('');
    // Clamp to Telegram limits (message text vs media caption) to avoid hard 400s.
    if (result.text && visibleLen > max) result.text = truncate(result.text, max, what);
  }

  validate(result);
  return result;
}

/** Post-serialization validation for the constraints Telegram enforces at the API. */
function validate(out: TelegramSendPayload): void {
  if (out.method === 'sendMediaGroup') {
    const n = out.mediaGroup?.length ?? 0;
    if (n === 1) {
      // A media group needs 2–10 items; a single item must be sent as a normal media message.
      const only = out.mediaGroup![0];
      out.method = only.type === 'video' ? 'sendVideo' : 'sendPhoto';
      if (only.type === 'video') out.video = only.media; else out.photo = only.media;
      if (only.caption) out.text = only.caption;
      out.mediaGroup = undefined;
    } else if (n > 10) {
      console.warn(`[teact] <MediaGroup> has ${n} items; Telegram allows max 10 — extra items dropped.`);
      out.mediaGroup = out.mediaGroup!.slice(0, 10);
    } else if (n === 0) {
      console.warn('[teact] <MediaGroup> has no items — nothing will be sent.');
    }
  }

  if (out.method === 'sendPoll') {
    const opts = out.pollOptions ?? [];
    if (opts.length < 2) {
      console.warn(`[teact] <Poll> needs at least 2 options (got ${opts.length}); Telegram will reject it.`);
    }
    if (out.pollType === 'quiz' && (out.pollCorrectOptionId == null || out.pollCorrectOptionId < 0 || out.pollCorrectOptionId >= opts.length)) {
      console.warn('[teact] <Poll.Quiz> requires a valid correctOptionId within the options range.');
    }
  }
}

function walk(node: OutputNode, out: TelegramSendPayload, segs: TextSegment[]): void {
  // A subtree hidden by the reconciler (Suspense/offscreen) must not leak into the payload.
  if ((node.props as { __hidden?: boolean }).__hidden) return;
  const lit = (text: string) => { if (text) segs.push({ text, literal: true }); };
  const raw = (text: string) => segs.push({ text, literal: false });
  const tag = (text: string) => segs.push({ text, literal: false, tag: true });

  switch (node.type) {
    case 'tg-message': {
      // If the user picked a parse mode, their `text` is verbatim (their escaping job);
      // otherwise it's a literal that we escape if formatting later forces HTML.
      if (node.props.text) {
        if (node.props.parseMode) raw(node.props.text); else lit(node.props.text);
      }
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.disablePreview) out.disablePreview = true;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case '#text': {
      if (node.props.value) lit(node.props.value);
      break;
    }

    case 'tg-bold': {
      out.parseMode = out.parseMode || 'HTML';
      tag('<b>');
      for (const c of node.children) walk(c, out, segs);
      tag('</b>');
      break;
    }

    case 'tg-italic': {
      out.parseMode = out.parseMode || 'HTML';
      tag('<i>');
      for (const c of node.children) walk(c, out, segs);
      tag('</i>');
      break;
    }

    case 'tg-underline':
    case 'tg-strike':
    case 'tg-spoiler':
    case 'tg-quote':
    case 'tg-link': {
      out.parseMode = out.parseMode || 'HTML';
      const [open, close] =
        node.type === 'tg-underline' ? ['<u>', '</u>']
        : node.type === 'tg-strike' ? ['<s>', '</s>']
        : node.type === 'tg-spoiler' ? ['<tg-spoiler>', '</tg-spoiler>']
        : node.type === 'tg-quote' ? [node.props.expandable ? '<blockquote expandable>' : '<blockquote>', '</blockquote>']
        : [`<a href="${escapeAttr(String(node.props.href ?? ''))}">`, '</a>'];
      tag(open);
      for (const c of node.children) walk(c, out, segs);
      tag(close);
      break;
    }

    case 'tg-code': {
      out.parseMode = out.parseMode || 'HTML';
      if (node.props.language) {
        tag(`<pre><code class="language-${escapeAttr(String(node.props.language))}">`);
        for (const c of node.children) walk(c, out, segs);
        tag('</code></pre>');
      } else {
        tag('<code>');
        for (const c of node.children) walk(c, out, segs);
        tag('</code>');
      }
      break;
    }

    case 'tg-keyboard': {
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-button-row': {
      if (!out.keyboard) out.keyboard = [];
      const row: InlineKeyboardButton[] = [];
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
      if (node.props.caption) lit(node.props.caption);
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.hasSpoiler) out.hasSpoiler = true;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-document': {
      out.method = 'sendDocument';
      out.document = node.props.src;
      if (node.props.caption) lit(node.props.caption);
      if (node.props.filename) out.filename = node.props.filename;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-video': {
      out.method = 'sendVideo';
      out.video = node.props.src;
      if (node.props.caption) lit(node.props.caption);
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.width) out.width = node.props.width;
      if (node.props.height) out.height = node.props.height;
      if (node.props.duration) out.duration = node.props.duration;
      if (node.props.supportsStreaming) out.supportsStreaming = true;
      if (node.props.hasSpoiler) out.hasSpoiler = true;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-animation': {
      out.method = 'sendAnimation';
      out.animation = node.props.src;
      if (node.props.caption) lit(node.props.caption);
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.width) out.width = node.props.width;
      if (node.props.height) out.height = node.props.height;
      if (node.props.duration) out.duration = node.props.duration;
      if (node.props.hasSpoiler) out.hasSpoiler = true;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-voice': {
      out.method = 'sendVoice';
      out.voice = node.props.src;
      if (node.props.caption) lit(node.props.caption);
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.duration) out.duration = node.props.duration;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-audio': {
      out.method = 'sendAudio';
      out.audio = node.props.src;
      if (node.props.caption) lit(node.props.caption);
      if (node.props.parseMode) out.parseMode = node.props.parseMode;
      if (node.props.performer) out.performer = node.props.performer;
      if (node.props.title) out.title = node.props.title;
      if (node.props.duration) out.duration = node.props.duration;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-video-note': {
      out.method = 'sendVideoNote';
      out.videoNote = node.props.src;
      if (node.props.duration) out.duration = node.props.duration;
      if (node.props.length) out.length = node.props.length;
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-sticker': {
      out.method = 'sendSticker';
      out.sticker = node.props.src;
      if (node.props.emoji) out.emoji = node.props.emoji;
      for (const c of node.children) walk(c, out, segs);
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
      for (const c of node.children) walk(c, out, segs);
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
      for (const c of node.children) walk(c, out, segs);
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
      if (node.props.heading) lit(node.props.heading);
      raw('\n');
      for (const c of node.children) walk(c, out, segs);
      raw('\n');
      break;
    }

    case 'tg-list': {
      const ordered = node.props.ordered === true;
      node.children.forEach((c, i) => {
        raw(ordered ? `${i + 1}. ` : '• ');
        walk(c, out, segs);
        raw('\n');
      });
      break;
    }

    case 'tg-list-item': {
      for (const c of node.children) walk(c, out, segs);
      break;
    }

    case 'tg-divider': {
      if (node.props.text) lit(node.props.text); else raw('────────────────────');
      raw('\n');
      break;
    }

    default: {
      for (const c of node.children) walk(c, out, segs);
    }
  }
}

function makeButton(node: OutputNode): InlineKeyboardButton | null {
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
