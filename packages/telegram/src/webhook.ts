import type { TgUpdate } from './types';

/** Header Telegram sends with every webhook request when a secret token is configured. */
export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Constant-time string comparison so the secret can't be probed via response timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Build a web-standard `(Request) => Promise<Response>` webhook handler.
 *
 * - Rejects non-POST (405) and wrong/missing secret tokens (401).
 * - Malformed JSON → 400 (Telegram won't retry a 4xx forever).
 * - Errors while *processing* an update are logged and still answered with 200: returning
 *   5xx makes Telegram redeliver the same update over and over, which turns one bug into
 *   a retry storm (and duplicate messages).
 */
export function createWebhookHandler(
  dispatch: (update: TgUpdate) => Promise<void>,
  opts: { secretToken?: string } = {},
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (opts.secretToken) {
      const got = request.headers.get(SECRET_HEADER) ?? '';
      if (!safeEqual(got, opts.secretToken)) return new Response('Unauthorized', { status: 401 });
    }
    let update: TgUpdate;
    try {
      update = (await request.json()) as TgUpdate;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (!update || typeof update !== 'object' || typeof update.update_id !== 'number') {
      return new Response('Bad Request', { status: 400 });
    }
    try {
      await dispatch(update);
    } catch (err) {
      console.error('[telegram] Webhook update failed:', err);
    }
    return new Response('OK', { status: 200 });
  };
}

/** A running HTTP server that can be closed. */
export interface WebhookServer {
  close(): Promise<void>;
}

/**
 * Serve `handler` on `port` at `path`. Uses `Bun.serve` on Bun and `node:http` elsewhere.
 * `node:http` is imported lazily so edge bundles never pull it in.
 */
export async function serveWebhook(
  handler: (request: Request) => Promise<Response>,
  port: number,
  path: string,
): Promise<WebhookServer> {
  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== path) return new Response('Not Found', { status: 404 });
    return handler(request);
  };

  const Bun = (globalThis as any).Bun;
  if (Bun?.serve) {
    let server: any;
    try {
      server = Bun.serve({ port, fetch: route });
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE') throw new Error(`[telegram] Port ${port} is already in use. Choose a different webhook port.`);
      throw err;
    }
    return { close: async () => { server.stop(true); } };
  }

  const { createServer } = await import('node:http');
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        // Telegram updates are small; refuse absurd bodies instead of buffering them.
        if (size > 10 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://localhost${req.url ?? '/'}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
      });
      const response = await route(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch (err) {
      console.error('[telegram] Webhook server error:', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE' ? new Error(`[telegram] Port ${port} is already in use. Choose a different webhook port.`) : err);
    });
    server.listen(port, resolve);
  });
  return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
