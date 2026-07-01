import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { RuntimeContext, type RuntimeContextValue } from '../packages/core/src/runtime/context';
import {
  useChat,
  useTelegram,
  usePhoto,
  useVideo,
  useAudio,
  useVoice,
  useDocument,
  useSticker,
  useLocation,
  useContact,
  useVenue,
  useAnimation,
} from '../packages/core/src/runtime/media-hooks';

function waitForCommit(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20));
}

const mockBotCtx = {
  chatId: '12345',
  userId: '67890',
  user: { id: '67890', username: 'testuser', firstName: 'Test', lastName: 'User', isBot: false, platform: 'telegram' as const },
  platform: 'telegram' as const,
  messageId: '100',
  text: 'hello',
  callbackData: undefined,
  raw: {
    api: {
      sendPhoto: async (...args: any[]) => ({ message_id: 1, args }),
      sendVideo: async (...args: any[]) => ({ message_id: 2, args }),
      sendAnimation: async (...args: any[]) => ({ message_id: 3, args }),
      sendAudio: async (...args: any[]) => ({ message_id: 4, args }),
      sendVoice: async (...args: any[]) => ({ message_id: 5, args }),
      sendDocument: async (...args: any[]) => ({ message_id: 6, args }),
      sendSticker: async (...args: any[]) => ({ message_id: 7, args }),
      sendLocation: async (...args: any[]) => ({ message_id: 8, args }),
      sendContact: async (...args: any[]) => ({ message_id: 9, args }),
      sendVenue: async (...args: any[]) => ({ message_id: 10, args }),
    },
    chat: { id: 12345 },
    from: { id: 67890, first_name: 'Test', is_bot: false },
  },
};

const mockRuntimeValue: RuntimeContextValue = {
  botCtx: mockBotCtx as any,
  session: {},
  updateSession: () => {},
  command: null,
};

async function renderWithRuntime<T>(hookFn: () => T): Promise<T> {
  let captured: T = null as any;

  function TestComponent() {
    captured = hookFn();
    return React.createElement('tg-message', { text: 'test' });
  }

  const root = createRoot(() => {});
  root.render(
    React.createElement(
      RuntimeContext.Provider,
      { value: mockRuntimeValue },
      React.createElement(TestComponent),
    ),
  );

  await waitForCommit();
  return captured;
}

describe('useChat hook', () => {
  test('returns chat info', async () => {
    const result = await renderWithRuntime(useChat);
    expect(result.chatId).toBe('12345');
    expect(result.userId).toBe('67890');
    expect(result.user.username).toBe('testuser');
    expect(result.text).toBe('hello');
    expect(result.platform).toBe('telegram');
    expect(result.messageId).toBe('100');
  });
});

describe('useTelegram hook', () => {
  test('returns api, ctx, chat, from, chatId', async () => {
    const result = await renderWithRuntime(useTelegram);
    expect(result.api).toBeDefined();
    expect(result.api.sendPhoto).toBeDefined();
    expect(result.chat).toEqual({ id: 12345 });
    expect(result.from).toEqual({ id: 67890, first_name: 'Test', is_bot: false });
    expect(result.chatId).toBe(12345);
  });
});

describe('usePhoto hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(usePhoto);
    expect(typeof result).toBe('function');
  });
});

describe('useVideo hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useVideo);
    expect(typeof result).toBe('function');
  });
});

describe('useAnimation hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useAnimation);
    expect(typeof result).toBe('function');
  });
});

describe('useAudio hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useAudio);
    expect(typeof result).toBe('function');
  });
});

describe('useVoice hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useVoice);
    expect(typeof result).toBe('function');
  });
});

describe('useDocument hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useDocument);
    expect(typeof result).toBe('function');
  });
});

describe('useSticker hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useSticker);
    expect(typeof result).toBe('function');
  });
});

describe('useLocation hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useLocation);
    expect(typeof result).toBe('function');
  });
});

describe('useContact hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useContact);
    expect(typeof result).toBe('function');
  });
});

describe('useVenue hook', () => {
  test('returns a callable function', async () => {
    const result = await renderWithRuntime(useVenue);
    expect(typeof result).toBe('function');
  });
});

describe('hooks throw outside RuntimeContext', () => {
  test('useChat throws without context', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };

    function BadComponent() {
      useChat();
      return React.createElement('tg-message', { text: 'bad' });
    }

    const root = createRoot(() => {});
    root.render(React.createElement(BadComponent));
    await waitForCommit();
    console.error = origError;

    expect(errors.some(e => e.message.includes('Teact hooks must be used inside a bot component'))).toBe(true);
  });
});
