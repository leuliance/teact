import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { RuntimeContext } from '../runtime/context';
import { WorkTrackerCtx } from './work-tracker';

// ---- useQuery: data fetching with caching, refetch, loading states ----

export interface UseQueryOptions<T> {
  /** Unique cache key. Changing this re-fetches. */
  key: string;
  /**
   * Async function that returns data. Pass the `signal` to `fetch` so a timed-out,
   * superseded or unmounted request is actually cancelled:
   * `fn: ({ signal }) => fetch(url, { signal }).then((r) => r.json())`
   */
  fn: (ctx: { signal: AbortSignal }) => Promise<T>;
  /**
   * Fail with a timeout error (and abort the request) after this many ms, so a hung API
   * shows an error instead of "Loading…" forever. `0` disables it. @default 15_000
   */
  timeout?: number;
  /** Auto-fetch on mount (default: true). */
  enabled?: boolean;
  /** Stale time in ms before refetching (default: 30s). */
  staleTime?: number;
  /** Refetch interval in ms (0 = disabled). */
  refetchInterval?: number;
  /**
   * Cache scope. `'chat'` (default) keeps each chat's results separate, so a query keyed
   * `'profile'` can never show one user another user's data. Use `'global'` for data
   * that's the same for everyone (e.g. a product catalog).
   */
  scope?: 'chat' | 'global';
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
}

const MAX_CACHE_ENTRIES = 1000;
const queryCache = new Map<string, { data: any; fetchedAt: number }>();

function cacheSet(key: string, data: unknown) {
  queryCache.delete(key);
  queryCache.set(key, { data, fetchedAt: Date.now() });
  if (queryCache.size > MAX_CACHE_ENTRIES) queryCache.delete(queryCache.keys().next().value as string);
}

function fresh(key: string, staleTime: number) {
  const cached = queryCache.get(key);
  return cached && Date.now() - cached.fetchedAt < staleTime ? cached : undefined;
}

export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const { key: userKey, fn, enabled = true, staleTime = 30_000, refetchInterval = 0, scope = 'chat' } = options;
  const runtime = useContext(RuntimeContext);
  const key = scope === 'chat' && runtime ? `${runtime.botCtx.platform}:${runtime.botCtx.chatId}::${userKey}` : userKey;
  const [state, setState] = useState<{ key: string; data: T | undefined }>(() => ({ key, data: fresh(key, staleTime)?.data }));
  // A new key must not keep showing the previous key's data.
  const data = state.key === key ? state.data : fresh(key, staleTime)?.data;
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(data === undefined && enabled);
  const mountedRef = useRef(true);
  // Latest fn without making `refetch` (and the interval) change identity every render.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(key);
  keyRef.current = key;

  const tracker = useContext(WorkTrackerCtx);
  const timeout = options.timeout ?? 15_000;
  const controllerRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    const requestKey = keyRef.current;
    // Cancel a superseded request (key changed, manual refetch) — never let it land.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setIsLoading(true);
    setError(undefined);
    const run = (async () => {
      try {
        const timedOut = new Promise<never>((_, reject) => {
          if (timeout > 0) {
            timer = setTimeout(() => {
              const err = new Error(`Request timed out after ${Math.round(timeout / 100) / 10}s`);
              err.name = 'TimeoutError';
              controller.abort(err);
              reject(err);
            }, timeout);
          }
        });
        const result = await Promise.race([fnRef.current({ signal: controller.signal }), timedOut]);
        cacheSet(requestKey, result);
        // Ignore results for a key we've since moved away from.
        if (mountedRef.current && keyRef.current === requestKey) setState({ key: requestKey, data: result });
      } catch (err) {
        if (controller.signal.aborted && controller.signal.reason?.name !== 'TimeoutError') return; // superseded/unmounted
        if (mountedRef.current && keyRef.current === requestKey) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (timer) clearTimeout(timer);
        if (controllerRef.current === controller) controllerRef.current = null;
        if (mountedRef.current && keyRef.current === requestKey) setIsLoading(false);
      }
    })();
    // On serverless, keep the request alive until the data has arrived and re-rendered.
    tracker?.track(run);
    await run;
  }, [timeout, tracker]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && !fresh(key, staleTime)) refetch();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    if (!refetchInterval || !enabled) return;
    const id = setInterval(refetch, refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval, enabled, refetch]);

  return {
    data,
    error,
    isLoading,
    isError: !!error,
    isSuccess: data !== undefined && !error,
    refetch,
  };
}

// ---- useMutation: for write operations (POST, PUT, DELETE etc.) ----

export interface UseMutationOptions<T, V> {
  fn: (variables: V) => Promise<T>;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export interface UseMutationResult<T, V> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  mutate: (variables: V) => Promise<T | undefined>;
  reset: () => void;
}

export function useMutation<T, V = void>(options: UseMutationOptions<T, V>): UseMutationResult<T, V> {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback(async (variables: V): Promise<T | undefined> => {
    const { fn, onSuccess, onError } = optionsRef.current;
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await fn(variables);
      setData(result);
      setSucceeded(true);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setSucceeded(false);
      onError?.(e);
      return undefined;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
    setSucceeded(false);
  }, []);

  return {
    data,
    error,
    isLoading,
    isError: !!error,
    // A mutation returning void/0/'' still succeeded.
    isSuccess: succeeded && !error,
    mutate,
    reset,
  };
}
