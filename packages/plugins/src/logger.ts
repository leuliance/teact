import { isHalted, type BotContext, type TeactPlugin } from '@teactjs/core';
import { chatTypeOf, updateKind, type UpdateKind } from './utils';

/** Log severity, lowest to highest. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** A structured log record produced by {@link logger}. */
export interface LogEntry {
  level: LogLevel;
  /** ISO timestamp. */
  time: string;
  /** `update.start` (debug only), `update` (handled) or `update.error`. */
  event: 'update.start' | 'update' | 'update.error';
  type: UpdateKind;
  platform: string;
  chatId: string;
  chatType?: string;
  userId: string;
  username?: string;
  /** Message text, truncated to `maxTextLength`. */
  text?: string;
  callbackData?: string;
  /** Total time spent in the rest of the pipeline (render + send), in ms. */
  durationMs?: number;
  /** `true` when a later middleware/plugin blocked the update (see `halt`). */
  halted?: boolean;
  error?: { name: string; message: string; stack?: string };
}

/** Fields that can be redacted from log entries. */
export type RedactableField = 'text' | 'callbackData' | 'username' | 'userId' | 'chatId';

/** A console-like object (e.g. `console`, pino, winston). */
export interface LoggerLike {
  debug?(msg: string): void;
  info?(msg: string): void;
  warn?(msg: string): void;
  error?(msg: string): void;
}

/** Custom sink — receives the structured entry and the formatted line. */
export type LogSink = (entry: LogEntry, line: string) => void;

/** Options for {@link logger}. */
export interface LoggerOptions {
  /** Minimum level to emit. Default `'info'` (`'debug'` also logs when an update starts). */
  level?: LogLevel;
  /** `'pretty'` (default) — one human-readable line; `'json'` — one JSON object per line. */
  format?: 'pretty' | 'json';
  /** Where to write. A sink function or a console-like object. Default `console`. */
  logger?: LogSink | LoggerLike;
  /**
   * Hide sensitive data: a list of fields to replace with `'[redacted]'`, or a function
   * that returns the entry to log (return a modified copy).
   */
  redact?: RedactableField[] | ((entry: LogEntry) => LogEntry);
  /** Max characters of message text to log. Default `100`. */
  maxTextLength?: number;
}

/**
 * Log every update (type, chat, user, truncated text / callback data), how long it
 * took to handle, and any error thrown by later middleware.
 *
 * Put it **first** in `plugins` so it measures everything and sees updates that other
 * plugins block (`halted: true`). Errors are logged and re-thrown.
 *
 * Note: render errors are caught by Teact's error boundary and never reach middleware;
 * use {@link errorReporter} to capture those.
 *
 * @example
 * logger({ format: 'json', redact: ['text'] })
 * logger({ logger: (entry) => pino.info(entry) })
 */
export function logger(options: LoggerOptions = {}): TeactPlugin {
  const min = LEVELS[options.level ?? 'info'];
  const format = options.format ?? 'pretty';
  const maxText = options.maxTextLength ?? 100;
  const sink = options.logger ?? console;

  const emit = (entry: LogEntry) => {
    if (LEVELS[entry.level] < min) return;
    let e = entry;
    if (typeof options.redact === 'function') e = options.redact({ ...entry });
    else if (options.redact) {
      e = { ...entry };
      for (const f of options.redact) if (e[f] != null) (e as any)[f] = '[redacted]';
    }
    const line = format === 'json' ? JSON.stringify(e) : pretty(e);
    if (typeof sink === 'function') sink(e, line);
    else {
      const fn = sink[e.level] ?? sink.info;
      fn?.call(sink, line);
    }
  };

  const base = (ctx: BotContext): Omit<LogEntry, 'level' | 'event' | 'time'> => {
    const text = ctx.text != null && ctx.text.length > maxText ? `${ctx.text.slice(0, maxText)}…` : ctx.text;
    const entry: Omit<LogEntry, 'level' | 'event' | 'time'> = {
      type: updateKind(ctx),
      platform: ctx.platform,
      chatId: ctx.chatId,
      userId: ctx.userId,
    };
    const chatType = chatTypeOf(ctx);
    if (chatType) entry.chatType = chatType;
    if (ctx.user?.username) entry.username = ctx.user.username;
    if (text != null) entry.text = text;
    if (ctx.callbackData != null) entry.callbackData = ctx.callbackData;
    return entry;
  };

  return {
    name: 'teact-logger',
    async middleware(ctx, next) {
      const start = performance.now();
      const info = base(ctx);
      emit({ level: 'debug', time: new Date().toISOString(), event: 'update.start', ...info });
      try {
        await next();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        emit({
          level: 'error',
          time: new Date().toISOString(),
          event: 'update.error',
          ...info,
          durationMs: round(performance.now() - start),
          error: { name: e.name, message: e.message, stack: e.stack },
        });
        throw err;
      }
      const entry: LogEntry = {
        level: 'info',
        time: new Date().toISOString(),
        event: 'update',
        ...info,
        durationMs: round(performance.now() - start),
      };
      if (isHalted(ctx)) entry.halted = true;
      emit(entry);
    },
  };
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function pretty(e: LogEntry): string {
  const who = e.username ? `@${e.username}` : `user ${e.userId}`;
  const what =
    e.callbackData != null ? `[callback] ${JSON.stringify(e.callbackData)}` :
    e.text != null ? `${JSON.stringify(e.text)}` : '';
  const parts = [
    e.time,
    e.level.toUpperCase().padEnd(5),
    e.event === 'update.start' ? '→' : e.event === 'update.error' ? '✖' : '←',
    e.type,
    `chat ${e.chatId}${e.chatType ? ` (${e.chatType})` : ''}`,
    who,
    what,
  ];
  if (e.durationMs != null) parts.push(`${e.durationMs}ms`);
  if (e.halted) parts.push('[blocked]');
  if (e.error) parts.push(`— ${e.error.name}: ${e.error.message}`);
  return parts.filter(Boolean).join(' ');
}
