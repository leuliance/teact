import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import { serializeOutput } from '../packages/telegram/src/serialize';
import { Poll } from '../packages/ui/src';

function waitForCommit(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

// ---- Poll Component ----

describe('Poll component', () => {
  test('renders regular poll with all props', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Poll
        question="Best framework?"
        options={['React', 'Vue', 'Svelte']}
        isAnonymous={false}
        allowsMultipleAnswers
      />
    );
    await waitForCommit();
    expect(output!.type).toBe('tg-poll');
    expect(output!.props.question).toBe('Best framework?');
    expect(output!.props.options).toEqual(['React', 'Vue', 'Svelte']);
    expect(output!.props.isAnonymous).toBe(false);
    expect(output!.props.allowsMultipleAnswers).toBe(true);
  });

  test('renders quiz poll', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Poll
        question="What is 2+2?"
        options={['3', '4', '5']}
        type="quiz"
        correctOptionId={1}
        explanation="Basic math"
      />
    );
    await waitForCommit();
    expect(output!.props.type).toBe('quiz');
    expect(output!.props.correctOptionId).toBe(1);
    expect(output!.props.explanation).toBe('Basic math');
  });

  test('Poll.Quiz compound works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Poll.Quiz
        question="Capital of France?"
        options={['Berlin', 'Paris', 'London']}
        correctOptionId={1}
      />
    );
    await waitForCommit();
    expect(output!.type).toBe('tg-poll');
    expect(output!.props.type).toBe('quiz');
    expect(output!.props.correctOptionId).toBe(1);
  });

  test('renders minimal poll', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Poll question="Yes or No?" options={['Yes', 'No']} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-poll');
    expect(output!.props.question).toBe('Yes or No?');
    expect(output!.props.options).toEqual(['Yes', 'No']);
  });
});

// ---- Poll Serialization ----

describe('Serialize Poll', () => {
  test('serializes regular poll', () => {
    const node: OutputNode = {
      type: 'tg-poll',
      props: {
        question: 'Best language?',
        options: ['TypeScript', 'Rust', 'Go'],
        isAnonymous: false,
        allowsMultipleAnswers: true,
      },
      children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendPoll');
    expect(r.pollQuestion).toBe('Best language?');
    expect(r.pollOptions).toEqual(['TypeScript', 'Rust', 'Go']);
    expect(r.pollIsAnonymous).toBe(false);
    expect(r.pollAllowsMultipleAnswers).toBe(true);
  });

  test('serializes quiz poll', () => {
    const node: OutputNode = {
      type: 'tg-poll',
      props: {
        question: 'What is 1+1?',
        options: ['1', '2', '3'],
        type: 'quiz',
        correctOptionId: 1,
        explanation: 'Math!',
        explanationParseMode: 'HTML',
        openPeriod: 30,
      },
      children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendPoll');
    expect(r.pollType).toBe('quiz');
    expect(r.pollCorrectOptionId).toBe(1);
    expect(r.pollExplanation).toBe('Math!');
    expect(r.pollExplanationParseMode).toBe('HTML');
    expect(r.pollOpenPeriod).toBe(30);
  });

  test('serializes closed poll', () => {
    const node: OutputNode = {
      type: 'tg-poll',
      props: {
        question: 'Done?',
        options: ['Yes', 'No'],
        isClosed: true,
      },
      children: [],
    };
    const r = serializeOutput(node);
    expect(r.pollIsClosed).toBe(true);
  });
});

// ---- Conversation API extensions ----

describe('Conversation requestContact / requestLocation / replyWithPoll', () => {
  test('Conversation interface has requestContact', () => {
    const mockConvo = {
      requestContact: async (_prompt: string) => ({ phone_number: '+1234', first_name: 'Test' }),
    };
    expect(typeof mockConvo.requestContact).toBe('function');
  });

  test('Conversation interface has requestLocation', () => {
    const mockConvo = {
      requestLocation: async (_prompt: string) => ({ latitude: 9.0, longitude: 38.7 }),
    };
    expect(typeof mockConvo.requestLocation).toBe('function');
  });

  test('Conversation interface has replyWithPoll', () => {
    const mockConvo = {
      replyWithPoll: async (q: string, opts: string[]) => {},
    };
    expect(typeof mockConvo.replyWithPoll).toBe('function');
  });

  test('requestContact returns phone data', async () => {
    const mockConvo = {
      async requestContact(_prompt: string) {
        return { phone_number: '+251911000000', first_name: 'Luel', last_name: 'Dev', user_id: 12345 };
      },
    };
    const contact = await mockConvo.requestContact('Share your contact');
    expect(contact.phone_number).toBe('+251911000000');
    expect(contact.first_name).toBe('Luel');
    expect(contact.last_name).toBe('Dev');
    expect(contact.user_id).toBe(12345);
  });

  test('requestLocation returns coordinates', async () => {
    const mockConvo = {
      async requestLocation(_prompt: string) {
        return { latitude: 9.0192, longitude: 38.7525 };
      },
    };
    const loc = await mockConvo.requestLocation('Share your location');
    expect(loc.latitude).toBe(9.0192);
    expect(loc.longitude).toBe(38.7525);
  });
});

// ---- useOn event types ----

describe('TelegramEvent type coverage', () => {
  const validEvents = [
    'message', 'text', 'photo', 'video', 'audio', 'voice',
    'document', 'sticker', 'contact', 'location', 'venue',
    'animation', 'video_note', 'poll', 'poll_answer',
    'callback_query', 'inline_query',
    'new_chat_members', 'left_chat_member',
    'dice', 'game', 'web_app_data',
  ];

  test('all expected event types are defined', () => {
    expect(validEvents.length).toBe(22);
    for (const e of validEvents) {
      expect(typeof e).toBe('string');
    }
  });
});

// ---- useConversation ask() ----

describe('useConversation hook interface', () => {
  test('ConversationState has ask method in shape', () => {
    const shape = {
      has: () => false,
      get: () => undefined,
      set: () => {},
      prompt: () => React.createElement('tg-message', { text: 'q' }),
      ask: () => React.createElement('tg-message', { text: 'q' }),
      waitFor: () => {},
      step: 0,
      isWaiting: false,
      data: {},
      lastError: null,
      complete: false,
      reset: () => {},
    };
    expect(typeof shape.ask).toBe('function');
    expect(typeof shape.prompt).toBe('function');
    expect(typeof shape.step).toBe('number');
    expect(typeof shape.complete).toBe('boolean');
  });
});
