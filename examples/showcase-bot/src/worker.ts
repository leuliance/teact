// Cloudflare Worker entry — deploy your Teact bot to the edge.
// src/index.ts exports the bot and only calls bot.start() when run directly
// (`if (import.meta.main)`), so importing it here does NOT start polling.
import { bot } from './index';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
}

export default {
  fetch: (request: Request, env: Env) =>
    bot.fetch(request, { token: env.TELEGRAM_BOT_TOKEN, secretToken: env.WEBHOOK_SECRET }),
};
