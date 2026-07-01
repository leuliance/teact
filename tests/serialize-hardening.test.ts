import { describe, test, expect } from 'bun:test';
import { serializeOutput, escapeHtml } from '../packages/telegram/src/serialize';
import type { OutputNode } from '../packages/core/src/renderer';

const text = (value: string): OutputNode => ({ type: '#text', props: { value }, children: [] });
const bold = (value: string): OutputNode => ({ type: 'tg-bold', props: {}, children: [text(value)] });

describe('serialize — HTML escaping (injection / parse-mode safety)', () => {
  test('escapes user content inside formatting tags', () => {
    // <Bold>{"a < b & c"}</Bold> — the tag survives, the content is escaped.
    const node: OutputNode = { type: 'tg-message', props: {}, children: [bold('a < b & c')] };
    const r = serializeOutput(node);
    expect(r.parseMode).toBe('HTML');
    expect(r.text).toBe('<b>a &lt; b &amp; c</b>');
  });

  test('escapes plain message text when formatting forces HTML mode', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: '5 > 3 && ok ' },
      children: [bold('yes')],
    };
    const r = serializeOutput(node);
    expect(r.text).toBe('5 &gt; 3 &amp;&amp; ok <b>yes</b>');
  });

  test('does NOT escape when the user explicitly opted into a parse mode (their responsibility)', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: '<b>hi</b> & <i>there</i>', parseMode: 'HTML' },
      children: [],
    };
    const r = serializeOutput(node);
    expect(r.text).toBe('<b>hi</b> & <i>there</i>');
  });

  test('plain text (no parse mode) is never escaped and stays literal', () => {
    const node: OutputNode = { type: 'tg-message', props: { text: 'a < b > c & d' }, children: [] };
    const r = serializeOutput(node);
    expect(r.parseMode).toBeUndefined();
    expect(r.text).toBe('a < b > c & d');
  });

  test('escapeHtml handles the three entities', () => {
    expect(escapeHtml('<a> & "b"')).toBe('&lt;a&gt; &amp; "b"');
  });
});

describe('serialize — length clamping', () => {
  test('truncates message text over 4096 chars', () => {
    const node: OutputNode = { type: 'tg-message', props: { text: 'x'.repeat(5000) }, children: [] };
    const r = serializeOutput(node);
    expect(r.text!.length).toBe(4096);
    expect(r.text!.endsWith('…')).toBe(true);
  });

  test('truncates media caption over 1024 chars', () => {
    const node: OutputNode = { type: 'tg-photo', props: { src: 'p.jpg', caption: 'y'.repeat(2000) }, children: [] };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendPhoto');
    expect(r.text!.length).toBe(1024);
  });
});

describe('serialize — media group validation', () => {
  const item = (src: string): OutputNode => ({ type: 'tg-media-photo', props: { src }, children: [] });

  test('a single-item group is downgraded to a normal sendPhoto', () => {
    const node: OutputNode = { type: 'tg-media-group', props: {}, children: [item('a.jpg')] };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendPhoto');
    expect(r.photo).toBe('a.jpg');
    expect(r.mediaGroup).toBeUndefined();
  });

  test('a group over 10 items is clamped to 10', () => {
    const children = Array.from({ length: 13 }, (_, i) => item(`p${i}.jpg`));
    const node: OutputNode = { type: 'tg-media-group', props: {}, children };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendMediaGroup');
    expect(r.mediaGroup!.length).toBe(10);
  });

  test('a valid 2–10 item group is preserved', () => {
    const node: OutputNode = { type: 'tg-media-group', props: {}, children: [item('a.jpg'), item('b.jpg')] };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendMediaGroup');
    expect(r.mediaGroup!.length).toBe(2);
  });
});

describe('serialize — hidden subtrees do not leak', () => {
  test('a __hidden node contributes no text', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'visible ' },
      children: [{ type: 'tg-bold', props: { __hidden: true }, children: [text('SECRET')] }],
    };
    const r = serializeOutput(node);
    expect(r.text).not.toContain('SECRET');
    expect(r.text).toContain('visible');
  });
});
