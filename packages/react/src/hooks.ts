import { useState, useEffect, useRef, useCallback } from 'react';

// ---- useQuery: data fetching with caching, refetch, loading states ----

export interface UseQueryOptions<T> {
  /** Unique cache key. Changing this re-fetches. */
  key: string;
  /** Async function that returns data. */
  fn: () => Promise<T>;
  /** Auto-fetch on mount (default: true). */
  enabled?: boolean;
  /** Stale time in ms before refetching (default: 30s). */
  staleTime?: number;
  /** Refetch interval in ms (0 = disabled). */
  refetchInterval?: number;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
}

const queryCache = new Map<string, { data: any; fetchedAt: number }>();

export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const { key, fn, enabled = true, staleTime = 30_000, refetchInterval = 0 } = options;
  const [data, setData] = useState<T | undefined>(() => {
    const cached = queryCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < staleTime) return cached.data;
    return undefined;
  });
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(!data && enabled);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await fn();
      if (mountedRef.current) {
        setData(result);
        queryCache.set(key, { data: result, fetchedAt: Date.now() });
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [key, fn]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      const cached = queryCache.get(key);
      if (!cached || Date.now() - cached.fetchedAt >= staleTime) {
        refetch();
      }
    }
    return () => { mountedRef.current = false; };
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
    isSuccess: !!data && !error,
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
  const { fn, onSuccess, onError } = options;
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const mutate = useCallback(async (variables: V): Promise<T | undefined> => {
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await fn(variables);
      setData(result);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      onError?.(e);
      return undefined;
    } finally {
      setIsLoading(false);
    }
  }, [fn, onSuccess, onError]);

  const reset = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
  }, []);

  return {
    data,
    error,
    isLoading,
    isError: !!error,
    isSuccess: !!data && !error,
    mutate,
    reset,
  };
}
