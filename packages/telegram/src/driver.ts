import type { TgUpdate, TgUser } from './types';

/** Sink that receives every update a driver gets, plus that framework's own context. */
export type UpdateSink = (update: TgUpdate, native?: unknown) => Promise<void>;

/** Options for {@link TelegramDriver.call}. */
export interface CallOptions {
  /** Abort the in-flight request (used to stop long polling promptly). */
  signal?: AbortSignal;
}

/**
 * The seam between Teact's Telegram adapter and a Telegram client library.
 *
 * Everything Telegram-specific that Teact needs — rendering, editing, polling, webhooks,
 * callback answering, conversations — is implemented once in `TelegramAdapter` on top of
 * these few primitives. A driver only has to:
 *   1. call a Bot API method (`call`), and
 *   2. push updates into Teact (`onUpdate` + `handleUpdate`).
 *
 * Built-in drivers:
 * - `fetchDriver()`  — zero dependencies, plain `fetch` (default; runs on any runtime/edge)
 * - `grammyDriver()` — from `@teactjs/telegram/grammy`, routes through a grammY `Bot`
 * - `gramioDriver()` — from `@teactjs/telegram/gramio`, routes through a GramIO `Bot`
 *
 * With the grammY/GramIO drivers every update first flows through that framework's own
 * middleware stack, so its plugins (sessions, rate limiters, i18n, logging, …) keep working.
 */
export interface TelegramDriver {
  /** Driver name, used in logs (e.g. `'fetch'`, `'grammy'`, `'gramio'`). */
  readonly name: string;
  /** Create/prepare the client. Resolves to the bot's own user (`getMe`). */
  init(token: string | undefined): Promise<TgUser>;
  /**
   * Invoke a Bot API method with its native snake_case params and resolve to the result.
   * Must reject with a `TelegramApiError` (see `toTelegramError`) when Telegram answers `ok:false`.
   */
  call(method: string, params: Record<string, unknown>, opts?: CallOptions): Promise<any>;
  /** Install the sink every update must end up in. Called once, before any update flows. */
  onUpdate(sink: UpdateSink): void;
  /** Feed one raw update through the driver's pipeline; resolves once the sink finished. */
  handleUpdate(update: TgUpdate): Promise<void>;
  /** Register framework-native middleware (grammY / GramIO). Unsupported by `fetchDriver`. */
  use?(...middleware: unknown[]): void;
  /** Release resources (close the client). Optional. */
  close?(): Promise<void>;
  /** The underlying client (grammY `Bot`, GramIO `Bot`), as an escape hatch. */
  readonly native?: unknown;
}
