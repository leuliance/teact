// @teactjs/core — the engine: reconciler, runtime, router, hooks, plugin host,
// and the platform-neutral Adapter contract. Components live in @teactjs/ui.

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

// ---- Engine (reconciler, node tree, platform-neutral types, context glue) ----

export { TNode, TextNode, createRoot } from './renderer';
export type { TeactRoot, OutputNode, User, BotContext, SessionData, SessionStore, Middleware, Adapter } from './renderer';

// Context glue + data hooks that @teactjs/ui imports from here (single instance).
export { ErrorBoundary, CallbackRegistryCtx } from './renderer';
export type { ErrorBoundaryProps, CallbackHandler, CallbackMap } from './renderer';
export { useQuery, useMutation } from './renderer';
export type { UseQueryOptions, UseQueryResult, UseMutationOptions, UseMutationResult } from './renderer';

// ---- Runtime (bot engine, hooks, router, plugins) ----

export { createBot, ROUTE_PREFIX } from './runtime';
export type { CreateBotOptions, CommandContext, CommandDef, ReplyOptions, ReplyButton, ReplyKeyboardButton, WebhookConfig } from './runtime';

export { MemorySessionStore } from './runtime';
export { compose, commandMiddleware } from './runtime';

export { createRouter, useNavigate, useParams, useRoute, redirect } from './runtime';
export type { RouterConfig, NavigateOptions, NavigateMode, BeforeLoadContext, RouteGuard, GuardRedirect, GuardComponent, GuardReply, GuardReplyOptions, GuardButton, RouteValue, CreateRouterOptions, PathParams, RouteCommand, ResolvedRouteCommand } from './runtime';

export { useConversation, useForm, useConversationContext, useFormContext, Conversation, Form } from './runtime';
export type { ConversationState, FormFieldDef, FormResult, Validator, ValidateFn, SchemaLike, StepDef, StepsConfig, StepActions, ConversationActions, FormActions } from './runtime';

export { useStream } from './runtime';
export type { UseStreamResult } from './runtime';

export { authPlugin, useAuth } from './runtime';
export type { AuthConfig, AuthState } from './runtime';

export { useAuthSession } from './runtime';
export type { AuthTokens, AuthSessionState } from './runtime';

export type { TeactPlugin } from './runtime';

export { ServicesCtx, useService, useOptionalService } from './runtime';
export type { ServiceMap } from './runtime';

export { defineConfig } from './runtime';
export type { TeactConfig } from './runtime';

export {
  RuntimeContext,
  useBot,
  useSession,
  usePlatform,
  useChatId,
  useText,
  useCallbackData,
  useCommand,
} from './runtime';
export type { RuntimeContextValue } from './runtime';

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
  useMedia,
} from './runtime';
export type { ChatInfo, TelegramAccess, MediaSenders } from './runtime';

export { useOn, useEventData } from './runtime';
export type { TelegramEvent, EventContext } from './runtime';

export { createI18n, useLocale } from './runtime';
export type { I18nConfig } from './runtime';

export { useInvoice } from './runtime';
export type { InvoiceConfig, InvoiceResult, LabeledPrice, SuccessfulPayment } from './runtime';
