import { describe, test, expect } from 'bun:test';
import { serializeOutput } from '../packages/telegram/src/serialize';
import type { OutputNode } from '../packages/renderer/src';

describe('Serialize new components', () => {
  test('serializes Alert', () => {
    const node: OutputNode = {
      type: 'tg-alert',
      props: { variant: 'warning', heading: '⚠️ Warning' },
      children: [{ type: '#text', props: { value: 'Be careful' }, children: [] }],
    };
    const result = serializeOutput(node);
    expect(result.text).toContain('⚠️ Warning');
    expect(result.text).toContain('Be careful');
  });

  test('serializes unordered List', () => {
    const node: OutputNode = {
      type: 'tg-list',
      props: { ordered: false },
      children: [
        { type: 'tg-list-item', props: {}, children: [{ type: '#text', props: { value: 'Apple' }, children: [] }] },
        { type: 'tg-list-item', props: {}, children: [{ type: '#text', props: { value: 'Banana' }, children: [] }] },
      ],
    };
    const result = serializeOutput(node);
    expect(result.text).toContain('• Apple');
    expect(result.text).toContain('• Banana');
  });

  test('serializes ordered List', () => {
    const node: OutputNode = {
      type: 'tg-list',
      props: { ordered: true },
      children: [
        { type: 'tg-list-item', props: {}, children: [{ type: '#text', props: { value: 'First' }, children: [] }] },
        { type: 'tg-list-item', props: {}, children: [{ type: '#text', props: { value: 'Second' }, children: [] }] },
      ],
    };
    const result = serializeOutput(node);
    expect(result.text).toContain('1. First');
    expect(result.text).toContain('2. Second');
  });

  test('serializes Divider', () => {
    const node: OutputNode = {
      type: 'tg-divider',
      props: { text: '────────────────────' },
      children: [],
    };
    const result = serializeOutput(node);
    expect(result.text).toContain('────────────────────');
  });

  test('serializes Divider with custom chars', () => {
    const node: OutputNode = {
      type: 'tg-divider',
      props: { text: '==========' },
      children: [],
    };
    const result = serializeOutput(node);
    expect(result.text).toContain('==========');
  });
});
