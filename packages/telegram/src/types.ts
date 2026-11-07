// Minimal, dependency-free Telegram Bot API types — only what Teact reads or writes.
// Kept local so @teactjs/telegram doesn't depend on any one framework's type package.

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  [key: string]: any;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  inline_message_id?: string;
  data?: string;
  [key: string]: any;
}

/** A Telegram `Update`. Only the fields Teact routes on are typed; the rest pass through. */
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  business_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  poll_answer?: { poll_id: string; user?: TgUser; option_ids: number[]; [key: string]: any };
  pre_checkout_query?: { id: string; from: TgUser; [key: string]: any };
  shipping_query?: { id: string; from: TgUser; [key: string]: any };
  inline_query?: { id: string; from: TgUser; [key: string]: any };
  my_chat_member?: { chat: TgChat; from: TgUser; [key: string]: any };
  chat_member?: { chat: TgChat; from: TgUser; [key: string]: any };
  message_reaction?: { chat: TgChat; user?: TgUser; [key: string]: any };
  [key: string]: any;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
  [key: string]: any;
}

export interface KeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
  [key: string]: any;
}
