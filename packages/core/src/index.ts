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

export { TNode, TextNode, createRoot } from '@teact/renderer';
export type { TeactRoot, OutputNode, User, BotContext, SessionData, SessionStore, Middleware } from '@teact/renderer';

// ---- Runtime (bot engine, hooks, router, plugins) ----

export { createBot } from '@teact/runtime';
export type { CreateBotOptions, CommandContext, CommandDef, ReplyOptions, ReplyButton, ReplyKeyboardButton, WebhookConfig } from '@teact/runtime';

export { MemorySessionStore } from '@teact/runtime';
export { compose, commandMiddleware } from '@teact/runtime';

export { createRouter, useNavigate, useParams, useRoute, redirect } from '@teact/runtime';
export type { RouterConfig, NavigateOptions, NavigateMode, BeforeLoadContext, RouteGuard, GuardRedirect, GuardComponent, GuardReply, GuardReplyOptions, GuardButton, RouteValue, CreateRouterOptions } from '@teact/runtime';

export { useConversation, useForm, useConversationContext, useFormContext, Conversation, Form } from '@teact/runtime';
export type { ConversationState, FormFieldDef, FormResult, Validator, ValidateFn, SchemaLike, StepDef, StepsConfig, StepActions, ConversationActions, FormActions } from '@teact/runtime';

export { useStream } from '@teact/runtime';
export type { UseStreamResult } from '@teact/runtime';

export { authPlugin, useAuth } from '@teact/runtime';
export type { AuthConfig, AuthState } from '@teact/runtime';

export { useAuthSession } from '@teact/runtime';
export type { AuthTokens, AuthSessionState } from '@teact/runtime';

export type { TeactPlugin } from '@teact/runtime';

export { defineConfig } from '@teact/runtime';
export type { TeactConfig } from '@teact/runtime';

export {
  RuntimeContext,
  useBot,
  useSession,
  usePlatform,
  useChatId,
  useText,
  useCallbackData,
  useCommand,
} from '@teact/runtime';
export type { RuntimeContextValue } from '@teact/runtime';

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
} from '@teact/runtime';
export type { ChatInfo, TelegramAccess } from '@teact/runtime';

export { useOn, useEventData } from '@teact/runtime';
export type { TelegramEvent, EventContext } from '@teact/runtime';

export { createI18n, useLocale } from '@teact/runtime';
export type { I18nConfig } from '@teact/runtime';

export { useInvoice } from '@teact/runtime';
export type { InvoiceConfig, InvoiceResult, LabeledPrice, SuccessfulPayment } from '@teact/runtime';
