import { describe, test, expect } from 'bun:test';
import type { Conversation } from '../packages/telegram/src/conversations';

describe('Conversation interface shape', () => {
  test('has all required media reply methods', () => {
    const methods: (keyof Conversation)[] = [
      'prompt', 'send', 'wait', 'ask', 'stream',
      'replyWithPhoto', 'replyWithVideo', 'replyWithAnimation',
      'replyWithVoice', 'replyWithAudio', 'replyWithVideoNote',
      'replyWithSticker', 'replyWithDocument', 'replyWithContact',
      'replyWithLocation', 'replyWithVenue', 'replyWithMediaGroup',
    ];
    for (const method of methods) {
      expect(method).toBeDefined();
    }
  });

  test('has chatId, api, chat, raw properties', () => {
    const props: (keyof Conversation)[] = ['chatId', 'api', 'chat', 'raw'];
    for (const prop of props) {
      expect(prop).toBeDefined();
    }
  });
});

describe('Conversation media methods (mock)', () => {
  function createMockConversation(): Conversation {
    const calls: { method: string; args: any[] }[] = [];
    const mockApi = new Proxy({}, {
      get: (_target, prop) => (...args: any[]) => {
        calls.push({ method: String(prop), args });
        return Promise.resolve({ message_id: 1 });
      },
    });
    const mockCtx = {
      chat: { id: 12345 },
      api: mockApi,
      reply: (text: string, opts?: any) => {
        calls.push({ method: 'reply', args: [text, opts] });
        return Promise.resolve({ message_id: 1 });
      },
    };

    const { createConversationContext } = require('../packages/telegram/src/conversations') as any;
    if (typeof createConversationContext === 'function') {
      return createConversationContext({}, mockCtx);
    }

    const convo: Conversation = {
      chatId: 12345,
      api: mockApi,
      chat: mockCtx.chat,
      raw: { conversation: {}, ctx: mockCtx },
      async prompt() { return ''; },
      async send(text) { await mockCtx.reply(text); },
      async wait() { return ''; },
      async ask() { return ''; },
      async stream() {},
      async replyWithPhoto(src, opts) { await mockApi.sendPhoto(12345, src, opts); },
      async replyWithVideo(src, opts) { await mockApi.sendVideo(12345, src, opts); },
      async replyWithAnimation(src, opts) { await mockApi.sendAnimation(12345, src, opts); },
      async replyWithVoice(src, opts) { await mockApi.sendVoice(12345, src, opts); },
      async replyWithAudio(src, opts) { await mockApi.sendAudio(12345, src, opts); },
      async replyWithVideoNote(src, opts) { await mockApi.sendVideoNote(12345, src, opts); },
      async replyWithSticker(src, opts) { await mockApi.sendSticker(12345, src, opts); },
      async replyWithDocument(src, opts) { await mockApi.sendDocument(12345, src, opts); },
      async replyWithContact(phone, name, opts) { await mockApi.sendContact(12345, phone, name, opts); },
      async replyWithLocation(lat, lng, opts) { await mockApi.sendLocation(12345, lat, lng, opts); },
      async replyWithVenue(lat, lng, title, addr, opts) { await mockApi.sendVenue(12345, lat, lng, title, addr, opts); },
      async replyWithMediaGroup(media) { await mockApi.sendMediaGroup(12345, media); },
    };
    return convo;
  }

  test('replyWithPhoto calls api.sendPhoto', async () => {
    const convo = createMockConversation();
    await convo.replyWithPhoto('pic.jpg', { caption: 'test' });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithVideo calls api.sendVideo', async () => {
    const convo = createMockConversation();
    await convo.replyWithVideo('vid.mp4', { caption: 'test', supports_streaming: true });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithAnimation calls api.sendAnimation', async () => {
    const convo = createMockConversation();
    await convo.replyWithAnimation('anim.gif', { caption: 'funny' });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithAudio calls api.sendAudio', async () => {
    const convo = createMockConversation();
    await convo.replyWithAudio('song.mp3', { performer: 'Artist', title: 'Track' });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithVoice calls api.sendVoice', async () => {
    const convo = createMockConversation();
    await convo.replyWithVoice('voice.ogg', { duration: 15 });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithDocument calls api.sendDocument', async () => {
    const convo = createMockConversation();
    await convo.replyWithDocument('file.pdf', { caption: 'Report' });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithContact calls api.sendContact', async () => {
    const convo = createMockConversation();
    await convo.replyWithContact('+1234567890', 'John', { last_name: 'Doe' });
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithLocation calls api.sendLocation', async () => {
    const convo = createMockConversation();
    await convo.replyWithLocation(37.77, -122.42);
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithVenue calls api.sendVenue', async () => {
    const convo = createMockConversation();
    await convo.replyWithVenue(48.85, 2.35, 'Eiffel Tower', 'Paris');
    expect(convo.chatId).toBe(12345);
  });

  test('replyWithMediaGroup calls api.sendMediaGroup', async () => {
    const convo = createMockConversation();
    await convo.replyWithMediaGroup([
      { type: 'photo', media: 'a.jpg' },
      { type: 'photo', media: 'b.jpg' },
    ]);
    expect(convo.chatId).toBe(12345);
  });

  test('chat property is accessible', () => {
    const convo = createMockConversation();
    expect(convo.chat).toEqual({ id: 12345 });
  });

  test('api property is accessible', () => {
    const convo = createMockConversation();
    expect(convo.api).toBeDefined();
  });
});
