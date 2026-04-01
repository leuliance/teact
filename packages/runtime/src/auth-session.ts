import { useCallback, useMemo } from 'react';
import { useSession } from './context';

/** Shape of auth data stored in the session. */
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/** Return value of `useAuthSession`. */
export interface AuthSessionState {
  /** Whether the user is currently authenticated (has a non-expired access token). */
  isAuthenticated: boolean;
  /** The current access token, or `null` if not logged in. */
  accessToken: string | null;
  /** The current refresh token, or `null`. */
  refreshToken: string | null;
  /** Expiry timestamp (ms since epoch), or `null`. */
  expiresAt: number | null;
  /** Store auth tokens. Marks the session as authenticated. */
  login(tokens: AuthTokens): void;
  /** Clear all auth data. */
  logout(): void;
  /** Update the access token (e.g. after a refresh). */
  setAccessToken(token: string, expiresAt?: number): void;
}

const AUTH_KEY = 'auth';

/**
 * Token-based auth session hook.
 *
 * Stores `accessToken`, `refreshToken`, and `expiresAt` inside the
 * per-chat session (backed by whatever `SessionStore` you configured —
 * memory, file, or custom).
 *
 * @example
 * ```tsx
 * const auth = useAuthSession();
 *
 * if (!auth.isAuthenticated) {
 *   return (
 *     <Message text="Please log in">
 *       <InlineKeyboard>
 *         <ButtonRow>
 *           <Button text="Login" onClick={() => auth.login({ accessToken: 'tok_abc' })} />
 *         </ButtonRow>
 *       </InlineKeyboard>
 *     </Message>
 *   );
 * }
 *
 * return <Message text={`Logged in! Token: ${auth.accessToken}`} />;
 * ```
 */
export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useSession<Record<string, any>>();
  const stored: Partial<AuthTokens> | undefined = session[AUTH_KEY];

  const isExpired = stored?.expiresAt ? Date.now() > stored.expiresAt : false;
  const isAuthenticated = !!stored?.accessToken && !isExpired;

  const login = useCallback((tokens: AuthTokens) => {
    setSession({ [AUTH_KEY]: tokens } as any);
  }, [setSession]);

  const logout = useCallback(() => {
    setSession({ [AUTH_KEY]: undefined } as any);
  }, [setSession]);

  const setAccessToken = useCallback((token: string, expiresAt?: number) => {
    const current: Partial<AuthTokens> = session[AUTH_KEY] ?? {};
    setSession({
      [AUTH_KEY]: { ...current, accessToken: token, ...(expiresAt != null ? { expiresAt } : {}) },
    } as any);
  }, [session, setSession]);

  return useMemo(() => ({
    isAuthenticated,
    accessToken: isAuthenticated ? (stored?.accessToken ?? null) : null,
    refreshToken: stored?.refreshToken ?? null,
    expiresAt: stored?.expiresAt ?? null,
    login,
    logout,
    setAccessToken,
  }), [isAuthenticated, stored, login, logout, setAccessToken]);
}
