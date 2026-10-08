import { halt, type BotContext, type TeactPlugin } from '@teactjs/core';
import { AdapterRef, chatTypeOf, idSet, type ChatType, type Reply } from './utils';

/** Options for {@link chatFilter}. */
export interface ChatFilterOptions {
  /**
   * Chat types the bot responds in. Default: all. The type is read from the raw update
   * (`ctx.raw.chat.type`); if it can't be determined (non-Telegram adapter) a chat with
   * `chatId === userId` counts as `'private'`, anything else is treated as unknown and
   * blocked when `allow` is set.
   */
  allow?: ChatType[];
  /** Allow-list of user ids. When set, everyone else is blocked. */
  users?: Array<string | number>;
  /** Deny-list of user **or** chat ids. Always wins over `users`/`allow`. */
  block?: Array<string | number>;
  /** Sent when an update is blocked. Default: silent. */
  onBlocked?: Reply;
}

/** Why an update was rejected by {@link chatFilter}. */
export type ChatFilterReason = 'blocked' | 'user' | 'chat-type';

function createCheck(options: ChatFilterOptions): (ctx: BotContext) => ChatFilterReason | null {
  const block = idSet(options.block);
  const users = idSet(options.users);
  const allow = options.allow ? new Set<string>(options.allow) : undefined;
  return (ctx) => {
    if (block && (block.has(String(ctx.userId)) || block.has(String(ctx.chatId)))) return 'blocked';
    if (users && !users.has(String(ctx.userId))) return 'user';
    if (allow) {
      const type = chatTypeOf(ctx);
      if (!type || !allow.has(type)) return 'chat-type';
    }
    return null;
  };
}

/**
 * Restrict where and for whom the bot works: by chat type (e.g. private chats only),
 * by a user allow-list (private/internal bots) and by a deny-list (banned users/chats).
 * Rejected updates are blocked — the component is not rendered.
 *
 * @example
 * chatFilter({ allow: ['private'], block: [666], onBlocked: 'Please DM me instead.' })
 * chatFilter({ users: [ADMIN_ID] }) // internal admin bot
 */
export function chatFilter(options: ChatFilterOptions = {}): TeactPlugin {
  const check = createCheck(options);
  const ref = new AdapterRef();
  return {
    name: 'teact-chat-filter',
    onStart(adapter) { ref.adapter = adapter; },
    async middleware(ctx, next) {
      if (check(ctx) == null) return next();
      halt(ctx);
      await ref.send(ctx, options.onBlocked, 'teact-chat-filter');
    },
  };
}
