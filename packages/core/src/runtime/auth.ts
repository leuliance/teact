import React, { useContext, createContext } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import type { TeactPlugin } from './plugin';
import { useBot } from './context';

export interface AuthConfig {
  /** Telegram user IDs with admin access. Admins implicitly have all roles. */
  admins?: (string | number)[];
  /** Named roles mapped to arrays of user IDs. */
  roles?: Record<string, (string | number)[]>;
}

export interface AuthState {
  userId: string;
  isAdmin: boolean;
  /** The user's highest role, or null if none. */
  role: string | null;
  /** Check if the current user has a specific role. Admins pass all checks. */
  is(role: string): boolean;
  /** Check if the current user has at least one of the given roles. */
  hasAny(...roles: string[]): boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

/**
 * Access the current user's auth state.
 * Requires `authPlugin()` to be registered.
 *
 * @example
 * const { isAdmin, is } = useAuth();
 * if (!is('moderator')) return <Message text="Access denied" />;
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth requires the authPlugin to be registered');
  return ctx;
}

/**
 * Role-based auth plugin.
 *
 * @example
 * authPlugin({
 *   admins: [123456789],
 *   roles: { moderator: [987654321, 111222333] },
 * })
 */
export function authPlugin(config: AuthConfig = {}): TeactPlugin {
  const adminSet = new Set((config.admins ?? []).map(String));
  const roleSets = new Map<string, Set<string>>();

  for (const [role, ids] of Object.entries(config.roles ?? {})) {
    roleSets.set(role, new Set(ids.map(String)));
  }

  const AuthProvider: FunctionComponent<{ children: ReactNode }> = ({ children }) => {
    const bot = useBot();
    const userId = bot.user.id;
    const isAdmin = adminSet.has(userId);

    let userRole: string | null = null;
    if (isAdmin) {
      userRole = 'admin';
    } else {
      for (const [role, set] of roleSets) {
        if (set.has(userId)) {
          userRole = role;
          break;
        }
      }
    }

    const authState: AuthState = {
      userId,
      isAdmin,
      role: userRole,
      is(role: string) {
        if (role === 'admin') return isAdmin;
        return isAdmin || userRole === role;
      },
      hasAny(...roles: string[]) {
        return roles.some(r => authState.is(r));
      },
    };

    return React.createElement(AuthCtx.Provider, { value: authState }, children);
  };

  return {
    name: 'auth',
    Provider: AuthProvider,
  };
}
