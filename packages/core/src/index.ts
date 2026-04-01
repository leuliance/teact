// ---- React primitives (re-exported for convenience) ----

export {
  useState,
  useEffect,
  useReducer,
  useMemo,
  useCallback,
  useRef,
  useContext,
  useId,
  use,
  createContext,
  memo,
  Fragment,
  createElement,
  Suspense,
} from 'react';

// ---- Renderer (internal reconciler types + createRoot) ----

export { TNode, TextNode, createRoot } from '@teactjs/renderer';
export type { TeactRoot, OutputNode, User, BotContext, SessionData, SessionStore, Middleware } from '@teactjs/renderer';

// ---- Runtime (bot engine, hooks, router, plugins) ----

export { createBot } from '@teactjs/runtime';
export type { CreateBotOptions, CommandContext, CommandDef, ReplyOptions, ReplyButton, ReplyKeyboardButton, WebhookConfig } from '@teactjs/runtime';

export { MemorySessionStore } from '@teactjs/runtime';
export { compose, commandMiddleware } from '@teactjs/runtime';

export { createRouter, useNavigate, useParams, useRoute, redirect } from '@teactjs/runtime';
export type { RouterConfig, NavigateOptions, NavigateMode, BeforeLoadContext, RouteGuard, GuardRedirect, GuardComponent, GuardReply, GuardReplyOptions, GuardButton, RouteValue, CreateRouterOptions } from '@teactjs/runtime';

export { useConversation, useForm, useConversationContext, useFormContext, Conversation, Form } from '@teactjs/runtime';
export type { ConversationState, FormFieldDef, FormResult, Validator, ValidateFn, SchemaLike, StepDef, StepsConfig, StepActions, ConversationActions, FormActions } from '@teactjs/runtime';

export { useStream } from '@teactjs/runtime';
export type { UseStreamResult } from '@teactjs/runtime';

export { authPlugin, useAuth } from '@teactjs/runtime';
export type { AuthConfig, AuthState } from '@teactjs/runtime';

export { useAuthSession } from '@teactjs/runtime';
export type { AuthTokens, AuthSessionState } from '@teactjs/runtime';

export type { TeactPlugin } from '@teactjs/runtime';

export { defineConfig } from '@teactjs/runtime';
export type { TeactConfig } from '@teactjs/runtime';

export {
  RuntimeContext,
  useBot,
  useSession,
  usePlatform,
  useChatId,
  useText,
  useCallbackData,
  useCommand,
} from '@teactjs/runtime';
export type { RuntimeContextValue } from '@teactjs/runtime';

export {
  useChat,
  useTelegram,
  usePhoto,
  useVideo,
  useAnimation,
  useAudio,
  useVoice,
  useDocument,
  useSticker,
  useLocation,
  useContact,
  useVenue,
  usePoll,
} from '@teactjs/runtime';
export type { ChatInfo, TelegramAccess } from '@teactjs/runtime';

export { useOn, useEventData } from '@teactjs/runtime';
export type { TelegramEvent, EventContext } from '@teactjs/runtime';

export { createI18n, useLocale } from '@teactjs/runtime';
export type { I18nConfig } from '@teactjs/runtime';

export { useInvoice } from '@teactjs/runtime';
export type { InvoiceConfig, InvoiceResult, LabeledPrice, SuccessfulPayment } from '@teactjs/runtime';
