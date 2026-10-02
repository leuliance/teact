// @teactjs/telegram — the Telegram platform adapter for Teact.
//
// Framework-agnostic: the adapter talks to Telegram through a small driver interface.
// The default `fetchDriver()` has zero dependencies; grammY and GramIO drivers live in
// `@teactjs/telegram/grammy` and `@teactjs/telegram/gramio`.

export { TelegramAdapter, DEFAULT_ALLOWED_UPDATES } from './adapter';
export type { TelegramAdapterConfig, WebhookConfig } from './adapter';

export type { TelegramDriver, UpdateSink, CallOptions } from './driver';
export { fetchDriver } from './drivers/fetch';
export type { FetchDriverOptions } from './drivers/fetch';

export {
  TelegramApiError,
  createTelegramApi,
  toTelegramError,
  isNotModifiedError,
  isForbiddenError,
} from './api';
export type { TelegramApi, ApiCaller } from './api';

export { serializeOutput, escapeHtml } from './serialize';
export type { TelegramSendPayload } from './serialize';
export { buildSendCall, buildEditCall } from './methods';
export type { ApiCall } from './methods';

export { createWebhookHandler } from './webhook';

export type { TgUpdate, TgMessage, TgUser, TgChat, TgCallbackQuery } from './types';

export { conversationsPlugin, defineConversation, ConversationCancelledError } from './conversations';
export type {
  Conversation,
  ConversationHandler,
  ConversationDef,
  ConversationsPluginOptions,
  ConversationsConfig,
  MediaGroupItem,
  PromptOptions,
  Validator,
} from './conversations';
export { streamPlugin } from './stream';
