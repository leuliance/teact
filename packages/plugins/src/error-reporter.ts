import React, { useContext, type ErrorInfo, type ReactNode } from 'react';
import { RuntimeContext, type BotContext, type OutputNode, type TeactPlugin } from '@teactjs/core';
import { AdapterRef, chatTypeOf, updateKind, type UpdateKind } from './utils';

/** Context fields that can be attached to a report. */
export type ReportField = 'user' | 'chat' | 'text' | 'callbackData' | 'raw';

/** Extra information passed to {@link ErrorReporterOptions.report}. */
export interface ErrorReportInfo {
  /** `'middleware'` — thrown by a later middleware / button handler; `'render'` — thrown while rendering a component. */
  source: 'middleware' | 'render';
  /** Update details, limited to the fields listed in `include`. */
  context: {
    type: UpdateKind;
    platform: string;
    user?: { id: string; username?: string };
    chat?: { id: string; type?: string };
    text?: string;
    callbackData?: string;
    raw?: unknown;
  };
  /** React component stack (render errors only). */
  componentStack?: string;
}

/** Options for {@link errorReporter}. */
export interface ErrorReporterOptions {
  /**
   * Send the error to your tracker. Must not throw (failures are caught and logged).
   *
   * @example
   * report: (err, ctx, info) => Sentry.captureException(err, {
   *   user: { id: ctx.userId },
   *   tags: { source: info.source, chat: ctx.chatId },
   *   extra: info.context,
   * })
   */
  report: (error: unknown, ctx: BotContext, info: ErrorReportInfo) => void | Promise<void>;
  /**
   * Message shown to the user when something fails. For render errors it replaces
   * Teact's default "Something went wrong" fallback. Default: none for middleware errors,
   * Teact's default fallback for render errors.
   */
  notifyUser?: string | OutputNode;
  /** Which update fields go into `info.context`. Default `['user', 'chat']` (no message content — PII). */
  include?: ReportField[];
  /** Also capture component render errors (via an error boundary). Default `true`. */
  captureRenderErrors?: boolean;
}

/**
 * Capture errors from the rest of the pipeline and send them to your error tracker
 * (Sentry, Bugsnag, a Slack webhook…), optionally telling the user something went wrong.
 *
 * - **Middleware / handler errors** (thrown by later plugins, user middleware, `onClick`
 *   handlers) are caught, reported, and swallowed so the update finishes cleanly.
 * - **Render errors** (thrown inside components) are caught by an error boundary the
 *   plugin adds around your app, reported, and replaced by `notifyUser` (or Teact's
 *   default fallback). The chat recovers on the next update.
 *
 * Put it near the **start** of `plugins` — it only sees errors from what runs after it
 * (including `createBot({ commands })` handlers, which run at the end of the pipeline).
 *
 * @example
 * import * as Sentry from '@sentry/bun';
 * errorReporter({
 *   report: (e) => Sentry.captureException(e),
 *   notifyUser: '😵 Something broke. We have been notified!',
 * })
 */
export function errorReporter(options: ErrorReporterOptions): TeactPlugin {
  const include = new Set<ReportField>(options.include ?? ['user', 'chat']);
  const ref = new AdapterRef();

  const buildInfo = (ctx: BotContext, source: ErrorReportInfo['source'], componentStack?: string): ErrorReportInfo => {
    const context: ErrorReportInfo['context'] = { type: updateKind(ctx), platform: ctx.platform };
    if (include.has('user')) context.user = { id: ctx.userId, username: ctx.user?.username };
    if (include.has('chat')) context.chat = { id: ctx.chatId, type: chatTypeOf(ctx) };
    if (include.has('text') && ctx.text != null) context.text = ctx.text;
    if (include.has('callbackData') && ctx.callbackData != null) context.callbackData = ctx.callbackData;
    if (include.has('raw')) context.raw = ctx.raw;
    const info: ErrorReportInfo = { source, context };
    if (componentStack) info.componentStack = componentStack;
    return info;
  };

  const report = async (error: unknown, ctx: BotContext, info: ErrorReportInfo) => {
    try {
      await options.report(error, ctx, info);
    } catch (err) {
      console.error('[teact-error-reporter] report() failed:', err);
    }
  };

  const plugin: TeactPlugin = {
    name: 'teact-error-reporter',
    onStart(adapter) { ref.adapter = adapter; },
    async middleware(ctx, next) {
      try {
        await next();
      } catch (error) {
        await report(error, ctx, buildInfo(ctx, 'middleware'));
        if (options.notifyUser != null) await ref.send(ctx, options.notifyUser, 'teact-error-reporter');
      }
    },
  };

  if (options.captureRenderErrors !== false) {
    const boundaryProps = {
      notifyUser: options.notifyUser,
      onError: (error: unknown, ctx: BotContext | undefined, stack?: string) => {
        if (ctx) void report(error, ctx, buildInfo(ctx, 'render', stack));
      },
    };
    plugin.Provider = function ErrorReporterProvider({ children }: { children: ReactNode }) {
      const botCtx = useContext(RuntimeContext)?.botCtx;
      return React.createElement(ReportingBoundary, { ...boundaryProps, ctx: botCtx }, children);
    };
  }

  return plugin;
}

interface BoundaryProps {
  ctx: BotContext | undefined;
  notifyUser?: string | OutputNode;
  onError: (error: unknown, ctx: BotContext | undefined, componentStack?: string) => void;
  children?: ReactNode;
}

interface BoundaryState {
  error: unknown;
  hasError: boolean;
  ctx: BotContext | undefined;
}

// React retries a failed render before committing to a boundary, so the same failure can
// surface more than once (and as distinct Error objects). Report once per update.
const reported = new WeakSet<object>();

class ReportingBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, hasError: false, ctx: this.props.ctx };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, hasError: true };
  }

  // A new update (new ctx object) resets the boundary so the chat recovers.
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.ctx !== state.ctx) return { ctx: props.ctx, error: null, hasError: false };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.reportOnce(error, info.componentStack ?? undefined);
  }

  private reportOnce(error: unknown, stack?: string) {
    const key = this.props.ctx ?? (error && typeof error === 'object' ? error : undefined);
    if (key) {
      if (reported.has(key)) return;
      reported.add(key);
    }
    this.props.onError(error, this.props.ctx, stack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const { notifyUser } = this.props;
    if (notifyUser == null) {
      // No custom fallback: report now (componentDidCatch won't run since we rethrow)
      // and let Teact's own error boundary render its default fallback.
      this.reportOnce(this.state.error);
      throw this.state.error;
    }
    return typeof notifyUser === 'string'
      ? React.createElement('tg-message', { text: notifyUser })
      : toElement(notifyUser);
  }
}

function toElement(node: OutputNode): React.ReactElement {
  return React.createElement(node.type, node.props, ...node.children.map(toElement));
}
