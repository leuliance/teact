// Internal engine barrel — the reconciler, node tree, platform-neutral types,
// and the React-context glue that MUST be a single instance shared between the
// engine and @teactjs/ui (which imports these from @teactjs/core).

export { TNode, TextNode } from './nodes';
export { createRoot, KNOWN_HOST_TYPES } from './reconciler';
export type { TeactRoot } from './reconciler';

export type {
  OutputNode,
  User,
  BotContext,
  SessionData,
  SessionStore,
  Middleware,
  Adapter,
  WebhookConfig,
  ListenOptions,
} from './types';

export { ErrorBoundary } from './error-boundary';
export type { ErrorBoundaryProps } from './error-boundary';

export { CallbackRegistryCtx } from './callback-registry';
export type { CallbackHandler, CallbackMap } from './callback-registry';

export { useQuery, useMutation } from './data-hooks';
export type {
  UseQueryOptions,
  UseQueryResult,
  UseMutationOptions,
  UseMutationResult,
} from './data-hooks';
