import type { PlatformApi } from '@teactjs/core';

/**
 * Error thrown when the Telegram Bot API answers `ok: false`. Drivers normalize their own
 * error types (grammY's `GrammyError`, GramIO's `TelegramError`) into this one, so
 * application code can handle failures the same way whichever driver is in use.
 */
export class TelegramApiError extends Error {
  readonly method: string;
  readonly errorCode: number;
  readonly description: string;
  readonly parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  /** The driver-native error, if this was converted from one. */
  readonly cause?: unknown;

  constructor(
    method: string,
    errorCode: number,
    description: string,
    parameters?: { retry_after?: number; migrate_to_chat_id?: number },
    cause?: unknown,
  ) {
    super(`Telegram API ${method} failed: ${errorCode} ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.errorCode = errorCode;
    this.description = description;
    this.parameters = parameters;
    this.cause = cause;
  }
}

/**
 * Normalize anything a driver might throw into a {@link TelegramApiError} when it's an API
 * error (grammY `GrammyError`, GramIO `TelegramError`, or a raw `{ ok:false }` body).
 * Network/other errors are returned unchanged.
 */
export function toTelegramError(method: string, err: unknown): unknown {
  if (err instanceof TelegramApiError) return err;
  const e = err as any;
  if (e && typeof e === 'object') {
    const code = e.error_code ?? e.code;
    const description = e.description ?? e.message;
    if (typeof code === 'number' && typeof description === 'string') {
      return new TelegramApiError(method, code, description, e.parameters ?? e.payload?.parameters, err);
    }
  }
  return err;
}

/** True for Telegram's harmless "message is not modified" edit error. */
export function isNotModifiedError(err: unknown): boolean {
  const e = err as any;
  const text = String(e?.description ?? e?.message ?? '');
  return text.includes('message is not modified');
}

/** True when the user blocked the bot / deleted their account / the bot was kicked. */
export function isForbiddenError(err: unknown): boolean {
  return err instanceof TelegramApiError && err.errorCode === 403;
}

/** A Bot API method caller: `(method, params) => result`. */
export type ApiCaller = (method: string, params: Record<string, unknown>) => Promise<any>;

/**
 * The Telegram API as seen by Teact: `api.call(method, params)` plus every Bot API
 * method as a property taking its native (snake_case) params object —
 * `api.sendMessage({ chat_id, text })`. Identical across all drivers.
 */
export type TelegramApi = PlatformApi & {
  call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
} & Record<string, (params?: Record<string, unknown>) => Promise<any>>;

/** Wrap a raw caller in the {@link TelegramApi} proxy. */
export function createTelegramApi(caller: ApiCaller): TelegramApi {
  const call = (method: string, params: Record<string, unknown> = {}) => caller(method, stripUndefined(params));
  const cache = new Map<string, (params?: Record<string, unknown>) => Promise<any>>();
  return new Proxy({ call } as TelegramApi, {
    get(target, prop) {
      if (prop === 'call') return target.call;
      // Not a thenable — lets `await api` and promise-resolution checks work.
      if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') return undefined;
      let fn = cache.get(prop);
      if (!fn) {
        fn = (params?: Record<string, unknown>) => call(prop, params ?? {});
        cache.set(prop, fn);
      }
      return fn;
    },
  });
}

/** Telegram rejects explicit `null`s on some fields; drop undefined keys before sending. */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
