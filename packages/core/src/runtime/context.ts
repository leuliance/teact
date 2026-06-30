import React, { useContext } from 'react';
import type { BotContext, SessionData } from '../renderer';

/** Internal context value provided to all components during a render cycle. */
export interface RuntimeContextValue {
  botCtx: BotContext;
  session: SessionData;
  updateSession: (patch: Partial<SessionData>) => void;
  command: { name: string; args: string[] } | null;
}

export const RuntimeContext = React.createContext<RuntimeContextValue | null>(null);

function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error('Teact hooks must be used inside a bot component');
  return ctx;
}

/**
 * Access the current bot context (chatId, userId, text, callbackData, raw update, etc.).
 *
 * @example
 * const { chatId, text, user } = useBot();
 */
export function useBot(): BotContext {
  return useRuntime().botCtx;
}

/**
 * Read and write session data that persists across messages for the current chat.
 *
 * @returns A `[session, updateSession]` tuple (like `useState`).
 *
 * @example
 * const [session, setSession] = useSession<{ counter: number }>();
 * setSession({ counter: (session.counter ?? 0) + 1 });
 */
export function useSession<T extends SessionData = SessionData>(): [T, (patch: Partial<T>) => void] {
  const rt = useRuntime();
  return [rt.session as T, rt.updateSession as (p: Partial<T>) => void];
}

/**
 * Returns the current platform name (e.g. `"telegram"`).
 *
 * @example
 * const platform = usePlatform(); // "telegram"
 */
export function usePlatform(): string {
  return useRuntime().botCtx.platform;
}

/**
 * Returns the current chat ID.
 *
 * @example
 * const chatId = useChatId();
 */
export function useChatId(): string {
  return useRuntime().botCtx.chatId;
}

/**
 * Returns the current message text, or `undefined` for callback queries.
 *
 * @example
 * const text = useText();
 * if (text === 'hello') return <Message text="Hi there!" />;
 */
export function useText(): string | undefined {
  return useRuntime().botCtx.text;
}

/**
 * Returns the current callback data, or `undefined` for normal messages.
 *
 * @example
 * const data = useCallbackData();
 */
export function useCallbackData(): string | undefined {
  return useRuntime().botCtx.callbackData;
}

/**
 * Returns the command that triggered this render, or `null`.
 *
 * Only populated when a handler-less command falls through to the component tree.
 * Useful in `useState` initializers to pick the starting screen based on the command.
 *
 * @example
 * const cmd = useCommand();
 * if (cmd?.name === 'settings') return <SettingsPage />;
 */
export function useCommand(): { name: string; args: string[] } | null {
  return useRuntime().command;
}
