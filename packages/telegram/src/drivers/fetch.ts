import { TelegramApiError } from '../api';
import type { CallOptions, TelegramDriver, UpdateSink } from '../driver';
import type { TgUpdate, TgUser } from '../types';

export interface FetchDriverOptions {
  /** Bot API server root. @default 'https://api.telegram.org' (use for a local Bot API server). */
  apiRoot?: string;
  /** Use Telegram's test environment (`/bot<token>/test/<method>`). */
  testEnvironment?: boolean;
  /** Custom `fetch` implementation (proxies, instrumentation, tests). @default globalThis.fetch */
  fetch?: typeof fetch;
  /**
   * Retries for flood-wait (429) and transient (5xx / network) failures.
   * 429s honour Telegram's `retry_after`. @default 3
   */
  maxRetries?: number;
  /** Never wait longer than this for a single flood-wait retry. @default 30 */
  maxRetryAfterSeconds?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

/** True when a param value must be uploaded as multipart (a file, not a URL / file_id). */
function isFile(v: unknown): v is Blob {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

function hasFiles(params: Record<string, unknown>): boolean {
  for (const v of Object.values(params)) {
    if (isFile(v)) return true;
    if (Array.isArray(v) && v.some((item) => item && typeof item === 'object' && isFile((item as any).media))) return true;
  }
  return false;
}

/** Build a multipart body, hoisting files nested in media arrays into `attach://` fields. */
function toFormData(params: Record<string, unknown>): FormData {
  const form = new FormData();
  let n = 0;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (isFile(value)) {
      form.append(key, value, (value as any).name ?? key);
    } else if (Array.isArray(value)) {
      const mapped = value.map((item) => {
        if (item && typeof item === 'object' && isFile((item as any).media)) {
          const field = `file${n++}`;
          form.append(field, (item as any).media, (item as any).media.name ?? field);
          return { ...item, media: `attach://${field}` };
        }
        return item;
      });
      form.append(key, JSON.stringify(mapped));
    } else if (typeof value === 'object') {
      form.append(key, JSON.stringify(value));
    } else {
      form.append(key, String(value));
    }
  }
  return form;
}

/**
 * Zero-dependency Telegram driver built on the web-standard `fetch`.
 *
 * The default driver. Works on Bun, Node 18+, Deno, Cloudflare Workers, Vercel Edge —
 * anywhere `fetch` exists. Handles 429 flood-waits (honouring `retry_after`), retries
 * transient 5xx/network errors, and uploads `Blob`/`File` params as multipart.
 *
 * @example
 * new TelegramAdapter({ driver: fetchDriver({ apiRoot: 'http://localhost:8081' }) })
 */
export function fetchDriver(options: FetchDriverOptions = {}): TelegramDriver {
  const apiRoot = (options.apiRoot ?? 'https://api.telegram.org').replace(/\/+$/, '');
  const maxRetries = options.maxRetries ?? 3;
  const maxRetryAfter = options.maxRetryAfterSeconds ?? 30;
  let token: string | undefined;
  let sink: UpdateSink | null = null;

  async function callOnce(method: string, params: Record<string, unknown>, opts?: CallOptions) {
    const doFetch = options.fetch ?? globalThis.fetch;
    const url = `${apiRoot}/bot${token}/${options.testEnvironment ? 'test/' : ''}${method}`;
    const init: RequestInit = { method: 'POST', signal: opts?.signal };
    if (hasFiles(params)) {
      init.body = toFormData(params);
    } else {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(params);
    }
    const res = await doFetch(url, init);
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw Object.assign(new Error(`Telegram API ${method}: HTTP ${res.status} (non-JSON response)`), { status: res.status });
    }
    if (!body?.ok) {
      throw new TelegramApiError(method, body?.error_code ?? res.status, body?.description ?? 'Unknown error', body?.parameters);
    }
    return body.result;
  }

  return {
    name: 'fetch',

    async init(t) {
      if (!t) throw new Error('[teact] fetchDriver needs a bot token (TELEGRAM_BOT_TOKEN).');
      token = t;
      return (await this.call('getMe', {})) as TgUser;
    },

    async call(method, params, opts) {
      if (!token) throw new Error('[teact] Telegram driver used before init() — no token yet.');
      for (let attempt = 0; ; attempt++) {
        try {
          return await callOnce(method, params, opts);
        } catch (err: any) {
          if (opts?.signal?.aborted || attempt >= maxRetries) throw err;
          if (err instanceof TelegramApiError) {
            const retryAfter = err.parameters?.retry_after;
            if (err.errorCode === 429 && retryAfter != null && retryAfter <= maxRetryAfter) {
              await sleep(retryAfter * 1000, opts?.signal);
              continue;
            }
            if (err.errorCode >= 500) {
              await sleep(500 * 2 ** attempt, opts?.signal);
              continue;
            }
            throw err;
          }
          // Network error (fetch threw) or non-JSON response — transient, back off and retry.
          if (err?.name === 'AbortError') throw err;
          await sleep(500 * 2 ** attempt, opts?.signal);
        }
      }
    },

    onUpdate(s) {
      sink = s;
    },

    async handleUpdate(update: TgUpdate) {
      if (!sink) throw new Error('[teact] fetchDriver received an update before onUpdate() was wired.');
      await sink(update);
    },
  };
}
