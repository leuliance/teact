import { describe, test, expect } from 'bun:test';
import { serializeOutput } from '../packages/telegram/src/serialize';
import type { OutputNode } from '../packages/core/src';

describe('Telegram serialize', () => {
  test('serializes a simple message', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Hello World' },
      children: [],
    };
    const result = serializeOutput(node);
    expect(result.method).toBe('sendMessage');
    expect(result.text).toBe('Hello World');
  });

  test('serializes message with inline keyboard', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Choose:' },
      children: [
        {
          type: 'tg-keyboard',
          props: {},
          children: [
            {
              type: 'tg-button-row',
              props: {},
              children: [
                { type: 'tg-button', props: { text: 'Yes', callbackData: 'yes' }, children: [] },
                { type: 'tg-button', props: { text: 'No', callbackData: 'no' }, children: [] },
              ],
            },
          ],
        },
      ],
    };

    const result = serializeOutput(node);
    expect(result.method).toBe('sendMessage');
    expect(result.text).toBe('Choose:');
    expect(result.keyboard).toHaveLength(1);
    expect(result.keyboard![0]).toHaveLength(2);
    expect(result.keyboard![0][0]).toEqual({ text: 'Yes', callback_data: 'yes' });
    expect(result.keyboard![0][1]).toEqual({ text: 'No', callback_data: 'no' });
  });

  test('serializes URL button', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Visit:' },
      children: [
        { type: 'tg-button', props: { text: 'Google', url: 'https://google.com' }, children: [] },
      ],
    };

    const result = serializeOutput(node);
    expect(result.keyboard![0][0]).toEqual({ text: 'Google', url: 'https://google.com' });
  });

  test('serializes photo', () => {
    const node: OutputNode = {
      type: 'tg-photo',
      props: { src: 'https://example.com/photo.jpg', caption: 'Nice' },
      children: [],
    };

    const result = serializeOutput(node);
    expect(result.method).toBe('sendPhoto');
    expect(result.photo).toBe('https://example.com/photo.jpg');
    expect(result.text).toBe('Nice');
  });

  test('serializes bold/italic as HTML', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: {},
      children: [
        {
          type: 'tg-bold',
          props: {},
          children: [{ type: '#text', props: { value: 'Important' }, children: [] }],
        },
      ],
    };

    const result = serializeOutput(node);
    expect(result.text).toContain('<b>Important</b>');
    expect(result.parseMode).toBe('HTML');
  });

  test('serializes #root wrapper', () => {
    const node: OutputNode = {
      type: '#root',
      props: {},
      children: [
        { type: 'tg-message', props: { text: 'Hello' }, children: [] },
      ],
    };

    const result = serializeOutput(node);
    expect(result.text).toBe('Hello');
  });
});
