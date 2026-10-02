import React, { useContext, useId, useState, useMemo, useCallback, createContext, type ReactNode, type FunctionComponent } from 'react';
import { CallbackRegistryCtx, ROUTE_PREFIX } from '@teactjs/core';

/** Replace `:param` segments in a route template with values from `params`. */
function buildRoutePath(route: string, params?: Record<string, string | number>): string {
  if (!params) return route;
  return route.replace(/:([A-Za-z0-9_]+)/g, (_, key) =>
    params[key] != null ? String(params[key]) : `:${key}`,
  );
}

// ---- Context for tree validation ----

const KeyboardCtx = createContext(false);
const ReplyKeyboardCtx = createContext(false);
const MediaGroupCtx = createContext(false);

// ---- Message ----

export interface MessageProps {
  text?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  disablePreview?: boolean;
  children?: ReactNode;
}

/**
 * Sends a text message. Supports inline formatting children and keyboard children.
 *
 * @example
 * <Message text="Hello, world!" parseMode="MarkdownV2">
 *   <InlineKeyboard>
 *     <ButtonRow><Button text="Click me" onClick={() => {}} /></ButtonRow>
 *   </InlineKeyboard>
 * </Message>
 */
export function Message({ text, parseMode, disablePreview, children }: MessageProps): React.ReactNode {
  return React.createElement('tg-message', { text, parseMode, disablePreview }, children);
}

// ---- InlineKeyboard ----

export interface InlineKeyboardProps {
  children?: ReactNode;
  /**
   * Auto-arrange direct `<Button>` children into rows of this many columns.
   * Lets you skip `<ButtonRow>` entirely for grid layouts.
   */
  columns?: number;
}

/**
 * Container for inline keyboard buttons. Must be a child of `<Message>`.
 *
 * `<ButtonRow>` is optional: a bare `<Button>` becomes its own row. Use
 * `columns` to auto-grid buttons, or `<InlineKeyboard.Row>` for manual rows.
 *
 * @example
 * // Auto-grid — no ButtonRow needed:
 * <InlineKeyboard columns={2}>
 *   <Button text="A" route="/a" />
 *   <Button text="B" route="/b" />
 *   <Button text="C" route="/c" />
 * </InlineKeyboard>
 *
 * @example
 * // Manual rows:
 * <InlineKeyboard>
 *   <InlineKeyboard.Row>
 *     <Button text="Yes" onClick={onYes} />
 *     <Button text="No" onClick={onNo} />
 *   </InlineKeyboard.Row>
 * </InlineKeyboard>
 */
export function InlineKeyboard({ children, columns }: InlineKeyboardProps): React.ReactNode {
  let content: ReactNode = children;
  if (columns && columns > 0) {
    const items = React.Children.toArray(children);
    const rows: React.ReactNode[] = [];
    for (let i = 0; i < items.length; i += columns) {
      rows.push(
        React.createElement(ButtonRow, { key: `row-${i}` }, ...items.slice(i, i + columns)),
      );
    }
    content = rows;
  }
  return React.createElement(
    KeyboardCtx.Provider,
    { value: true },
    React.createElement('tg-keyboard', null, content),
  );
}

// ---- ButtonRow ----

export interface ButtonRowProps { children?: ReactNode; }

/** A row of buttons inside an `<InlineKeyboard>`. */
export function ButtonRow({ children }: ButtonRowProps): React.ReactNode {
  const insideKeyboard = useContext(KeyboardCtx);
  if (!insideKeyboard) {
    throw new Error(
      '[Teact] <ButtonRow> must be used inside <InlineKeyboard>.\n' +
      'Wrap your ButtonRow with <InlineKeyboard> first.',
    );
  }
  return React.createElement('tg-button-row', null, children);
}

// ---- Button ----

export type ButtonVariant = 'default' | 'primary' | 'destructive' | 'outline';

export interface ButtonProps {
  text: string;
  variant?: ButtonVariant;
  onClick?: string | (() => void | Promise<void>);
  url?: string;
  conversation?: string;
  /** Navigate to this route when tapped (declarative alternative to `onClick={() => navigate(...)}`). */
  route?: string;
  /** Fills `:param` segments in `route` (e.g. route="/pokemon/:id" params={{ id }}). */
  params?: Record<string, string | number>;
}

const VARIANT_PREFIX: Record<ButtonVariant, string> = {
  default: '',
  primary: '▸ ',
  destructive: '✕ ',
  outline: '◦ ',
};

/**
 * An inline keyboard button. Must be inside `<ButtonRow>` within `<InlineKeyboard>`.
 *
 * @param props.text - Button label displayed to the user.
 * @param props.onClick - Callback function or raw callback_data string.
 * @param props.url - Opens a URL when tapped (no callback).
 * @param props.variant - Visual prefix hint: `'primary'`, `'destructive'`, `'outline'`, or `'default'`.
 *
 * @example
 * <Button text="Visit" url="https://example.com" />
 * <Button text="Delete" variant="destructive" onClick={handleDelete} />
 */
export function Button({ text, variant = 'default', onClick, url, conversation, route, params }: ButtonProps): React.ReactNode {
  const insideKeyboard = useContext(KeyboardCtx);
  if (!insideKeyboard) {
    throw new Error(
      '[Teact] <Button> must be used inside <InlineKeyboard>.\n' +
      'Example:\n  <InlineKeyboard>\n    <Button text="Click me" onClick={...} />\n  </InlineKeyboard>',
    );
  }

  const registry = useContext(CallbackRegistryCtx);
  const id = useId();

  let callbackData: string | undefined;

  if (url) {
    // URL buttons have no callback_data
  } else if (route) {
    callbackData = `${ROUTE_PREFIX}${buildRoutePath(route, params)}`;
  } else if (conversation) {
    callbackData = `__convo:${conversation}`;
  } else if (typeof onClick === 'function') {
    callbackData = `__cb:${id}`;
    registry?.handlers.set(callbackData, onClick);
  } else if (typeof onClick === 'string') {
    callbackData = onClick;
  } else {
    callbackData = text;
  }

  const displayText = VARIANT_PREFIX[variant] + text;
  return React.createElement('tg-button', { text: displayText, callbackData, url });
}

// ---- WebAppButton (Button.WebApp) ----

export interface WebAppButtonProps {
  text: string;
  url: string;
  variant?: ButtonVariant;
}

/** A button that opens a Telegram Web App. Use as `<Button.WebApp>`. */
export function WebAppButton({ text, url, variant = 'default' }: WebAppButtonProps): React.ReactNode {
  const insideKeyboard = useContext(KeyboardCtx);
  if (!insideKeyboard) {
    throw new Error(
      '[Teact] <Button.WebApp> must be used inside <InlineKeyboard>.',
    );
  }
  const displayText = VARIANT_PREFIX[variant] + text;
  return React.createElement('tg-button', { text: displayText, webAppUrl: url });
}

// ---- Photo ----

export interface PhotoProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  hasSpoiler?: boolean;
  children?: ReactNode;
}

/**
 * Sends a photo message.
 *
 * @example
 * <Photo src="https://example.com/cat.jpg" caption="A cute cat" />
 */
export function Photo({ src, caption, parseMode, hasSpoiler, children }: PhotoProps): React.ReactNode {
  return React.createElement('tg-photo', { src, caption, parseMode, hasSpoiler }, children);
}

// ---- Video ----

export interface VideoProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  width?: number;
  height?: number;
  duration?: number;
  supportsStreaming?: boolean;
  hasSpoiler?: boolean;
  children?: ReactNode;
}

/**
 * Sends a video message.
 *
 * @example
 * <Video src="https://example.com/clip.mp4" caption="Watch this" />
 */
export function Video({ src, caption, parseMode, width, height, duration, supportsStreaming, hasSpoiler, children }: VideoProps): React.ReactNode {
  return React.createElement('tg-video', { src, caption, parseMode, width, height, duration, supportsStreaming, hasSpoiler }, children);
}

// ---- Animation (GIF) ----

export interface AnimationProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  width?: number;
  height?: number;
  duration?: number;
  hasSpoiler?: boolean;
  children?: ReactNode;
}

/** Sends a GIF/animation message. */
export function Animation({ src, caption, parseMode, width, height, duration, hasSpoiler, children }: AnimationProps): React.ReactNode {
  return React.createElement('tg-animation', { src, caption, parseMode, width, height, duration, hasSpoiler }, children);
}

// ---- Voice ----

export interface VoiceProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  duration?: number;
  children?: ReactNode;
}

/** Sends a voice message (`.ogg` encoded with OPUS). */
export function Voice({ src, caption, parseMode, duration, children }: VoiceProps): React.ReactNode {
  return React.createElement('tg-voice', { src, caption, parseMode, duration }, children);
}

// ---- Audio ----

export interface AudioProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  performer?: string;
  title?: string;
  duration?: number;
  children?: ReactNode;
}

/** Sends an audio file (shown with player UI in Telegram). */
export function Audio({ src, caption, parseMode, performer, title, duration, children }: AudioProps): React.ReactNode {
  return React.createElement('tg-audio', { src, caption, parseMode, performer, title, duration }, children);
}

// ---- VideoNote ----

export interface VideoNoteProps {
  src: string;
  duration?: number;
  length?: number;
}

/** Sends a round video note (Telegram circle video). */
export function VideoNote({ src, duration, length }: VideoNoteProps): React.ReactNode {
  return React.createElement('tg-video-note', { src, duration, length });
}

// ---- Sticker ----

export interface StickerProps {
  src: string;
  emoji?: string;
}

/** Sends a sticker by file ID or URL. */
export function Sticker({ src, emoji }: StickerProps): React.ReactNode {
  return React.createElement('tg-sticker', { src, emoji });
}

// ---- Document ----

export interface DocumentProps { src: string; caption?: string; filename?: string; children?: ReactNode; }

/**
 * Sends a document/file message.
 *
 * @example
 * <Document src="https://example.com/report.pdf" caption="Monthly report" />
 */
export function Document({ src, caption, filename, children }: DocumentProps): React.ReactNode {
  return React.createElement('tg-document', { src, caption, filename }, children);
}

// ---- Contact ----

export interface ContactProps {
  phoneNumber: string;
  firstName: string;
  lastName?: string;
  vcard?: string;
}

/** Sends a contact card. */
export function Contact({ phoneNumber, firstName, lastName, vcard }: ContactProps): React.ReactNode {
  return React.createElement('tg-contact', { phoneNumber, firstName, lastName, vcard });
}

// ---- Location ----

export interface LocationProps {
  latitude: number;
  longitude: number;
  horizontalAccuracy?: number;
}

/**
 * Sends a static location pin.
 *
 * @example
 * <Location latitude={9.0192} longitude={38.7525} />
 */
export function Location({ latitude, longitude, horizontalAccuracy }: LocationProps): React.ReactNode {
  return React.createElement('tg-location', { latitude, longitude, horizontalAccuracy });
}

// ---- LiveLocation (Location.Live) ----

export interface LiveLocationProps {
  latitude: number;
  longitude: number;
  livePeriod: number;
  horizontalAccuracy?: number;
  heading?: number;
  proximityAlertRadius?: number;
}

/** Sends a live location that updates in real-time. Use as `<Location.Live>`. */
export function LiveLocation({ latitude, longitude, livePeriod, horizontalAccuracy, heading, proximityAlertRadius }: LiveLocationProps): React.ReactNode {
  return React.createElement('tg-location', { latitude, longitude, livePeriod, horizontalAccuracy, heading, proximityAlertRadius });
}

// ---- Venue (Location.Venue) ----

export interface VenueProps {
  latitude: number;
  longitude: number;
  title: string;
  address: string;
  foursquareId?: string;
  foursquareType?: string;
  googlePlaceId?: string;
  googlePlaceType?: string;
}

/** Sends a venue (location with name and address). Use as `<Location.Venue>`. */
export function Venue({ latitude, longitude, title, address, foursquareId, foursquareType, googlePlaceId, googlePlaceType }: VenueProps): React.ReactNode {
  return React.createElement('tg-venue', { latitude, longitude, title, address, foursquareId, foursquareType, googlePlaceId, googlePlaceType });
}

// ---- MediaGroup ----

export interface MediaGroupProps { children?: ReactNode; }

/**
 * Groups multiple photos/videos into a single album message.
 *
 * @example
 * <MediaGroup>
 *   <MediaGroup.Photo src="https://example.com/a.jpg" />
 *   <MediaGroup.Photo src="https://example.com/b.jpg" caption="Second" />
 * </MediaGroup>
 */
export function MediaGroup({ children }: MediaGroupProps): React.ReactNode {
  return React.createElement(
    MediaGroupCtx.Provider,
    { value: true },
    React.createElement('tg-media-group', null, children),
  );
}

// ---- MediaPhoto (MediaGroup.Photo) ----

export interface MediaPhotoProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  hasSpoiler?: boolean;
}

/** A photo within a `<MediaGroup>`. Use as `<MediaGroup.Photo>`. */
export function MediaPhoto({ src, caption, parseMode, hasSpoiler }: MediaPhotoProps): React.ReactNode {
  const insideGroup = useContext(MediaGroupCtx);
  if (!insideGroup) {
    throw new Error(
      '[Teact] <MediaGroup.Photo> must be used inside <MediaGroup>.',
    );
  }
  return React.createElement('tg-media-photo', { src, caption, parseMode, hasSpoiler });
}

// ---- MediaVideo (MediaGroup.Video) ----

export interface MediaVideoProps {
  src: string;
  caption?: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  width?: number;
  height?: number;
  duration?: number;
  supportsStreaming?: boolean;
  hasSpoiler?: boolean;
}

/** A video within a `<MediaGroup>`. Use as `<MediaGroup.Video>`. */
export function MediaVideo({ src, caption, parseMode, width, height, duration, supportsStreaming, hasSpoiler }: MediaVideoProps): React.ReactNode {
  const insideGroup = useContext(MediaGroupCtx);
  if (!insideGroup) {
    throw new Error(
      '[Teact] <MediaGroup.Video> must be used inside <MediaGroup>.',
    );
  }
  return React.createElement('tg-media-video', { src, caption, parseMode, width, height, duration, supportsStreaming, hasSpoiler });
}

// ---- ReplyKeyboard ----

export interface ReplyKeyboardProps {
  oneTimeKeyboard?: boolean;
  resizeKeyboard?: boolean;
  placeholder?: string;
  isPersistent?: boolean;
  children?: ReactNode;
}

/**
 * A custom reply keyboard (buttons below the input field).
 *
 * @example
 * <ReplyKeyboard>
 *   <ReplyKeyboard.Row>
 *     <ReplyKeyboard.Button text="Yes" />
 *     <ReplyKeyboard.Button text="No" />
 *   </ReplyKeyboard.Row>
 * </ReplyKeyboard>
 */
export function ReplyKeyboard({ oneTimeKeyboard, resizeKeyboard = true, placeholder, isPersistent, children }: ReplyKeyboardProps): React.ReactNode {
  return React.createElement(
    ReplyKeyboardCtx.Provider,
    { value: true },
    React.createElement('tg-reply-keyboard', { oneTimeKeyboard, resizeKeyboard, placeholder, isPersistent }, children),
  );
}

// ---- ReplyRow (ReplyKeyboard.Row) ----

export interface ReplyRowProps { children?: ReactNode; }

/** A row inside `<ReplyKeyboard>`. Use as `<ReplyKeyboard.Row>`. */
export function ReplyRow({ children }: ReplyRowProps): React.ReactNode {
  const inside = useContext(ReplyKeyboardCtx);
  if (!inside) {
    throw new Error('[Teact] <ReplyKeyboard.Row> must be used inside <ReplyKeyboard>.');
  }
  return React.createElement('tg-reply-row', null, children);
}

// ---- ReplyButton (ReplyKeyboard.Button) ----

export interface ReplyButtonProps { text: string; }

/** A text button inside `<ReplyKeyboard>`. Use as `<ReplyKeyboard.Button>`. */
export function ReplyButton({ text }: ReplyButtonProps): React.ReactNode {
  const inside = useContext(ReplyKeyboardCtx);
  if (!inside) {
    throw new Error('[Teact] <ReplyKeyboard.Button> must be used inside <ReplyKeyboard>.');
  }
  return React.createElement('tg-reply-button', { text });
}

// ---- RequestContactButton (ReplyKeyboard.RequestContact) ----

export interface RequestContactButtonProps { text: string; }

/** A reply button that requests the user's phone contact. Use as `<ReplyKeyboard.RequestContact>`. */
export function RequestContactButton({ text }: RequestContactButtonProps): React.ReactNode {
  const inside = useContext(ReplyKeyboardCtx);
  if (!inside) {
    throw new Error('[Teact] <ReplyKeyboard.RequestContact> must be used inside <ReplyKeyboard>.');
  }
  return React.createElement('tg-reply-button', { text, requestContact: true });
}

// ---- RequestLocationButton (ReplyKeyboard.RequestLocation) ----

export interface RequestLocationButtonProps { text: string; }

/** A reply button that requests the user's location. Use as `<ReplyKeyboard.RequestLocation>`. */
export function RequestLocationButton({ text }: RequestLocationButtonProps): React.ReactNode {
  const inside = useContext(ReplyKeyboardCtx);
  if (!inside) {
    throw new Error('[Teact] <ReplyKeyboard.RequestLocation> must be used inside <ReplyKeyboard>.');
  }
  return React.createElement('tg-reply-button', { text, requestLocation: true });
}

// ---- ReplyKeyboardRemove ----

/** Removes the active custom reply keyboard from the chat. */
export function ReplyKeyboardRemove(): React.ReactNode {
  return React.createElement('tg-reply-keyboard-remove');
}

// ---- Notification ----

export interface NotificationProps {
  text: string;
  showAlert?: boolean;
}

/** Shows a callback query notification (toast) or alert popup to the user. */
export function Notification({ text, showAlert }: NotificationProps): React.ReactNode {
  return React.createElement('tg-notification', { text, showAlert });
}

// ---- Poll ----

export interface PollProps {
  question: string;
  options: string[];
  isAnonymous?: boolean;
  type?: 'regular' | 'quiz';
  allowsMultipleAnswers?: boolean;
  correctOptionId?: number;
  explanation?: string;
  explanationParseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  openPeriod?: number;
  isClosed?: boolean;
}

/**
 * Sends a poll. Use `<Poll.Quiz>` for quiz-type polls with a correct answer.
 *
 * @example
 * <Poll question="Favorite starter?" options={['Bulbasaur', 'Charmander', 'Squirtle']} />
 */
export function Poll({
  question, options, isAnonymous, type, allowsMultipleAnswers,
  correctOptionId, explanation, explanationParseMode, openPeriod, isClosed,
}: PollProps): React.ReactNode {
  return React.createElement('tg-poll', {
    question, options, isAnonymous, type, allowsMultipleAnswers,
    correctOptionId, explanation, explanationParseMode, openPeriod, isClosed,
  });
}

// ---- Formatting ----

export interface BoldProps { children?: ReactNode; }
/** Bold text formatting. Use as `<Message.Bold>`. */
export function Bold({ children }: BoldProps): React.ReactNode {
  return React.createElement('tg-bold', null, children);
}

export interface ItalicProps { children?: ReactNode; }
/** Italic text formatting. Use as `<Message.Italic>`. */
export function Italic({ children }: ItalicProps): React.ReactNode {
  return React.createElement('tg-italic', null, children);
}

export interface CodeProps { language?: string; children?: ReactNode; }
/** Monospace/code block formatting. Use as `<Message.Code>`. */
export function Code({ language, children }: CodeProps): React.ReactNode {
  return React.createElement('tg-code', { language }, children);
}

export interface UnderlineProps { children?: ReactNode; }
/** Underlined text. */
export function Underline({ children }: UnderlineProps): React.ReactNode {
  return React.createElement('tg-underline', null, children);
}

export interface StrikeProps { children?: ReactNode; }
/** Strikethrough text. */
export function Strike({ children }: StrikeProps): React.ReactNode {
  return React.createElement('tg-strike', null, children);
}

export interface SpoilerProps { children?: ReactNode; }
/** Hidden-until-tapped spoiler text. */
export function Spoiler({ children }: SpoilerProps): React.ReactNode {
  return React.createElement('tg-spoiler', null, children);
}

export interface LinkProps { href: string; children?: ReactNode; }
/**
 * An inline hyperlink.
 *
 * @example
 * <Message>Read the <Link href="https://teact-docs.vercel.app">docs</Link>.</Message>
 */
export function Link({ href, children }: LinkProps): React.ReactNode {
  return React.createElement('tg-link', { href }, children ?? href);
}

export interface MentionProps { userId: string | number; children?: ReactNode; }
/**
 * Mention a user by id — works even for users without a username.
 *
 * @example
 * const { user } = useBot();
 * <Message>Welcome, <Mention userId={user.id}>{user.firstName}</Mention>!</Message>
 */
export function Mention({ userId, children }: MentionProps): React.ReactNode {
  return React.createElement('tg-link', { href: `tg://user?id=${userId}` }, children ?? String(userId));
}

export interface QuoteProps {
  /** Collapse long quotes behind "show more". */
  expandable?: boolean;
  children?: ReactNode;
}
/** A block quotation. */
export function Quote({ expandable, children }: QuoteProps): React.ReactNode {
  return React.createElement('tg-quote', { expandable }, children);
}

// ---- Alert ----

export type AlertVariant = 'info' | 'warning' | 'error' | 'success';

const ALERT_ICON: Record<AlertVariant, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
  success: '✅',
};

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
}

/**
 * A styled alert box with icon prefix. Variants: `'info'`, `'warning'`, `'error'`, `'success'`.
 *
 * @example
 * <Alert variant="success" title="Saved">Your preferences have been updated.</Alert>
 */
export function Alert({ variant = 'info', title, children }: AlertProps): React.ReactNode {
  const icon = ALERT_ICON[variant];
  const heading = title ? `${icon} ${title}` : icon;
  return React.createElement('tg-alert', { variant, heading }, children);
}

// ---- List ----

export interface ListProps {
  ordered?: boolean;
  children?: ReactNode;
}

/**
 * A text list. Use `<List.Item>` children. Set `ordered` for numbered items.
 *
 * @example
 * <List>
 *   <List.Item>Pikachu</List.Item>
 *   <List.Item>Charizard</List.Item>
 * </List>
 */
export function List({ ordered = false, children }: ListProps): React.ReactNode {
  return React.createElement('tg-list', { ordered }, children);
}

export interface ListItemProps { children?: ReactNode; }

/** A single item in a `<List>`. Use as `<List.Item>`. */
export function ListItem({ children }: ListItemProps): React.ReactNode {
  return React.createElement('tg-list-item', null, children);
}

// ---- Divider ----

export interface DividerProps {
  char?: string;
  length?: number;
}

/**
 * A horizontal divider line.
 *
 * @param props.char - Character to repeat (default `'─'`).
 * @param props.length - Number of repetitions (default `20`).
 */
export function Divider({ char = '─', length = 20 }: DividerProps): React.ReactNode {
  return React.createElement('tg-divider', { text: char.repeat(length) });
}

// ---- Pagination ----

export interface UsePaginationResult<T> {
  /** Items on the current page. */
  items: T[];
  /** Current page, 1-based. */
  page: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  next(): void;
  prev(): void;
  goTo(page: number): void;
}

/**
 * Slice a list into pages. Pair with `<Pagination>` for the buttons.
 *
 * @example
 * const pager = usePagination(products, { pageSize: 5 });
 * return (
 *   <Message text={pager.items.map((p) => p.name).join('\n')}>
 *     <InlineKeyboard>
 *       <Pagination page={pager.page} pageCount={pager.pageCount} onChange={pager.goTo} />
 *     </InlineKeyboard>
 *   </Message>
 * );
 */
export function usePagination<T>(all: readonly T[], opts: { pageSize?: number; initialPage?: number } = {}): UsePaginationResult<T> {
  const pageSize = Math.max(1, opts.pageSize ?? 10);
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const [rawPage, setPage] = useState(opts.initialPage ?? 1);
  // Clamp if the list shrank underneath us.
  const page = Math.min(Math.max(1, rawPage), pageCount);
  const goTo = useCallback((p: number) => setPage(Math.min(Math.max(1, p), pageCount)), [pageCount]);
  const items = useMemo(() => all.slice((page - 1) * pageSize, page * pageSize), [all, page, pageSize]);
  return {
    items,
    page,
    pageCount,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    next: () => goTo(page + 1),
    prev: () => goTo(page - 1),
    goTo,
  };
}

export interface PaginationProps {
  /** Current page, 1-based. */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** Show « and » buttons that jump to the first/last page. @default true when pageCount > 3 */
  showEdges?: boolean;
}

/**
 * A `‹ 2 / 5 ›` navigation row. Must be inside `<InlineKeyboard>`. Renders nothing for a single page.
 */
export function Pagination({ page, pageCount, onChange, showEdges }: PaginationProps): React.ReactNode {
  if (pageCount <= 1) return null;
  const edges = showEdges ?? pageCount > 3;
  const noop = () => {};
  const buttons: React.ReactElement[] = [];
  const btn = (key: string, text: string, onClick: () => void) =>
    buttons.push(React.createElement(Button, { key, text, onClick }));
  if (edges) btn('first', page > 1 ? '«' : '·', page > 1 ? () => onChange(1) : noop);
  btn('prev', page > 1 ? '‹' : '·', page > 1 ? () => onChange(page - 1) : noop);
  btn('label', `${page} / ${pageCount}`, noop);
  btn('next', page < pageCount ? '›' : '·', page < pageCount ? () => onChange(page + 1) : noop);
  if (edges) btn('last', page < pageCount ? '»' : '·', page < pageCount ? () => onChange(pageCount) : noop);
  return React.createElement(ButtonRow, null, ...buttons);
}

// ---- Confirm ----

export interface ConfirmProps {
  /** The question. */
  text: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  /** Show the confirm button as destructive (✕ prefix). */
  destructive?: boolean;
  parseMode?: MessageProps['parseMode'];
}

/**
 * A yes/no prompt.
 *
 * @example
 * if (confirming) return (
 *   <Confirm text="Delete your account?" destructive onConfirm={remove} onCancel={() => setConfirming(false)} />
 * );
 */
export function Confirm({ text, onConfirm, onCancel, confirmText = 'Yes', cancelText = 'Cancel', destructive, parseMode }: ConfirmProps): React.ReactNode {
  return React.createElement(
    Message,
    { text, parseMode },
    React.createElement(
      InlineKeyboard,
      null,
      React.createElement(
        ButtonRow,
        null,
        React.createElement(Button, { text: confirmText, variant: destructive ? 'destructive' : 'default', onClick: onConfirm }),
        React.createElement(Button, { text: cancelText, onClick: onCancel ?? (() => {}) }),
      ),
    ),
  );
}

// ---- Suspense Fallback ----

export interface SuspenseFallbackProps { text?: string; }

export function SuspenseFallback({ text = '⏳ Loading...' }: SuspenseFallbackProps): React.ReactNode {
  return React.createElement('tg-message', { text });
}

// ---- Compound component assignments (shadcn-like composability) ----

Message.Bold = Bold;
Message.Italic = Italic;
Message.Code = Code;
Message.Underline = Underline;
Message.Strike = Strike;
Message.Spoiler = Spoiler;
Message.Link = Link;
Message.Mention = Mention;
Message.Quote = Quote;

InlineKeyboard.Row = ButtonRow;
InlineKeyboard.Button = Button;

Button.Row = ButtonRow;
Button.WebApp = WebAppButton;

Location.Live = LiveLocation;
Location.Venue = Venue;

MediaGroup.Photo = MediaPhoto;
MediaGroup.Video = MediaVideo;

ReplyKeyboard.Row = ReplyRow;
ReplyKeyboard.Button = ReplyButton;
ReplyKeyboard.RequestContact = RequestContactButton;
ReplyKeyboard.RequestLocation = RequestLocationButton;

List.Item = ListItem;

Poll.Quiz = function QuizPoll(props: Omit<PollProps, 'type'> & { correctOptionId: number }): React.ReactNode {
  return Poll({ ...props, type: 'quiz' });
};
