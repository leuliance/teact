import { TelegramApiError } from './api';
import type { TelegramDriver } from './driver';
import type { TgUpdate } from './types';

export interface PollingOptions {
  /** Update types to receive. */
  allowedUpdates?: readonly string[];
  /** Skip updates that piled up while the bot was offline. @default false */
  dropPendingUpdates?: boolean;
  /** Long-poll timeout in seconds. @default 30 */
  timeout?: number;
  /** Max updates processed concurrently (across chats; one chat is always sequential). @default 100 */
  concurrency?: number;
}

/**
 * Driver-independent long polling over `getUpdates`.
 *
 * Updates are dispatched concurrently (bounded) so one slow chat can't stall the others —
 * per-chat ordering is guaranteed by the Teact engine, which serializes each chat's
 * updates. Survives network blips with exponential backoff, and stops promptly by aborting
 * the in-flight long poll.
 */
export class Poller {
  private abort: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private inFlight = new Set<Promise<void>>();

  constructor(
    private readonly driver: TelegramDriver,
    private readonly dispatch: (update: TgUpdate) => Promise<void>,
    private readonly opts: PollingOptions = {},
  ) {}

  get running(): boolean {
    return this.loop !== null;
  }

  async start(): Promise<void> {
    if (this.loop) return;
    // getUpdates is refused (409) while a webhook is set — clear it first, like grammY/GramIO do.
    await this.driver.call('deleteWebhook', { drop_pending_updates: this.opts.dropPendingUpdates ?? false });
    this.abort = new AbortController();
    this.loop = this.run(this.abort.signal);
  }

  async stop(): Promise<void> {
    if (!this.loop) return;
    this.abort?.abort();
    await this.loop.catch(() => {});
    await Promise.allSettled([...this.inFlight]);
    this.loop = null;
    this.abort = null;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let offset = 0;
    let failures = 0;
    const concurrency = this.opts.concurrency ?? 100;

    while (!signal.aborted) {
      let updates: TgUpdate[];
      try {
        updates = await this.driver.call(
          'getUpdates',
          { offset, timeout: this.opts.timeout ?? 30, allowed_updates: this.opts.allowedUpdates },
          { signal },
        );
        failures = 0;
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof TelegramApiError && err.errorCode === 401) {
          console.error('[telegram] Bot token rejected (401 Unauthorized) — check TELEGRAM_BOT_TOKEN. Polling stopped.');
          return;
        }
        if (err instanceof TelegramApiError && err.errorCode === 409) {
          console.error('[telegram] Another instance is polling with this token (409 Conflict). Retrying…');
        } else {
          console.error('[telegram] getUpdates failed:', (err as Error)?.message ?? err);
        }
        failures++;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** failures, 30_000)));
        continue;
      }

      for (const update of updates) {
        offset = update.update_id + 1;
        while (this.inFlight.size >= concurrency) await Promise.race(this.inFlight);
        const task = this.dispatch(update)
          .catch((err) => console.error('[telegram] Error processing update:', err))
          .finally(() => this.inFlight.delete(task));
        this.inFlight.add(task);
      }
    }
  }
}
