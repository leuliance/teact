import type { TeactPlugin } from '@teactjs/core';
import type { TelegramAdapter } from './adapter';
import type { TgUser } from './types';

/** An incoming inline query (`@yourbot something` typed in any chat). */
export interface InlineQuery {
  id: string;
  from: TgUser;
  /** What the user typed after the bot's username. */
  query: string;
  /** Pagination offset you returned as `nextOffset` last time ('' for the first page). */
  offset: string;
  chat_type?: string;
  location?: { latitude: number; longitude: number };
}

/** Any Bot API `InlineQueryResult` (use the `inlineArticle`/`inlinePhoto` helpers or raw objects). */
export type InlineResult = Record<string, unknown> & { type: string };

export interface InlineAnswer {
  results: InlineResult[];
  /** Seconds Telegram may cache the results. @default 300 */
  cacheTime?: number;
  /** Cache per user instead of globally (results depend on who asks). */
  isPersonal?: boolean;
  /** Pass back as `query.offset` to load the next page. */
  nextOffset?: string;
  /** A button shown above the results (e.g. "Open bot to sign in"). */
  button?: { text: string; start_parameter?: string; web_app?: { url: string } };
}

export interface InlineQueryPluginOptions {
  /** Called when the user picks a result (enable "inline feedback" in @BotFather). */
  onChosen?: (chosen: { result_id: string; from: TgUser; query: string; inline_message_id?: string }) => void | Promise<void>;
}

let autoId = 0;

/** A text result: tapping it sends `text` into the chat. */
export function inlineArticle(r: {
  id?: string;
  title: string;
  text: string;
  description?: string;
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  thumbnailUrl?: string;
  url?: string;
  /** Inline keyboard rows attached to the sent message (url buttons work best here). */
  buttons?: { text: string; url: string }[][];
}): InlineResult {
  return stripUndef({
    type: 'article',
    id: r.id ?? `a${++autoId}`,
    title: r.title,
    description: r.description,
    thumbnail_url: r.thumbnailUrl,
    url: r.url,
    input_message_content: stripUndef({ message_text: r.text, parse_mode: r.parseMode }),
    reply_markup: r.buttons ? { inline_keyboard: r.buttons } : undefined,
  });
}

/** A photo result (by URL). */
export function inlinePhoto(r: {
  id?: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  caption?: string;
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
}): InlineResult {
  return stripUndef({
    type: 'photo',
    id: r.id ?? `p${++autoId}`,
    photo_url: r.url,
    thumbnail_url: r.thumbnailUrl ?? r.url,
    title: r.title,
    caption: r.caption,
    parse_mode: r.parseMode,
  });
}

function stripUndef<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Answer inline queries — `@yourbot pikachu` from any chat. Enable inline mode for your bot
 * in @BotFather (`/setinline`) first. Works on every driver.
 *
 * @example
 * plugins: [inlineQueryPlugin(async ({ query }) =>
 *   (await searchPokemon(query)).map((p) =>
 *     inlineArticle({ id: String(p.id), title: p.name, text: `${p.name} — #${p.id}`, thumbnailUrl: p.sprite }),
 *   ),
 * )]
 */
export function inlineQueryPlugin(
  handler: (query: InlineQuery) => InlineResult[] | InlineAnswer | Promise<InlineResult[] | InlineAnswer>,
  options: InlineQueryPluginOptions = {},
): TeactPlugin {
  return {
    name: 'inline-query',
    onStart(adapter) {
      const tg = adapter as unknown as TelegramAdapter;
      if (typeof tg.on !== 'function' || !tg.api) {
        console.warn('[teact] inlineQueryPlugin needs the TelegramAdapter.');
        return;
      }
      tg.on('update:inline_query', (async (update: any) => {
        const query = update.inline_query as InlineQuery;
        try {
          const answer = await handler(query);
          const a: InlineAnswer = Array.isArray(answer) ? { results: answer } : answer;
          // Telegram rejects more than 50 results per answer.
          if (a.results.length > 50) {
            console.warn(`[teact] inlineQueryPlugin returned ${a.results.length} results; Telegram allows 50 — use nextOffset to paginate.`);
          }
          await tg.api.call('answerInlineQuery', stripUndef({
            inline_query_id: query.id,
            results: a.results.slice(0, 50),
            cache_time: a.cacheTime,
            is_personal: a.isPersonal,
            next_offset: a.nextOffset,
            button: a.button,
          }));
        } catch (err) {
          console.error('[teact] inline query handler failed:', err);
        }
      }) as any);
      if (options.onChosen) {
        tg.on('update:chosen_inline_result', (async (update: any) => {
          try { await options.onChosen!(update.chosen_inline_result); }
          catch (err) { console.error('[teact] onChosen failed:', err); }
        }) as any);
      }
    },
  };
}
