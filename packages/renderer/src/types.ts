/** Serialized output tree that adapters consume to send platform messages. */
export interface OutputNode {
  type: string;
  props: Record<string, any>;
  children: OutputNode[];
}

export interface User {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBot?: boolean;
  platform: string;
}

export interface BotContext {
  chatId: string;
  userId: string;
  user: User;
  platform: string;
  messageId?: string;
  text?: string;
  callbackData?: string;
  /** The bot's own username (e.g. "my_bot"), available after connection. */
  botUsername?: string;
  raw: any;
}

export interface SessionData {
  [key: string]: any;
}

export interface SessionStore {
  get(key: string): Promise<SessionData | null>;
  set(key: string, data: SessionData): Promise<void>;
  delete(key: string): Promise<void>;
}

export type Middleware = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;
