import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import {
  Message, ReplyKeyboard, ReplyRow, ReplyButton,
  RequestContactButton, ReplyKeyboardRemove,
} from '../packages/ui/src/components';
import { serializeOutput } from '../packages/telegram/src/serialize';

const waitForCommit = (ms = 15) => new Promise<void>(r => setTimeout(r, ms));

describe('ReplyKeyboard rendering', () => {
  test('ReplyKeyboard with one row and one button renders correctly', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Choose:">
        <ReplyKeyboard>
          <ReplyRow>
            <ReplyButton text="Option A" />
          </ReplyRow>
        </ReplyKeyboard>
      </Message>,
    );
    await waitForCommit();

    expect(output).toBeTruthy();
    const kb = output!.children[0];
    expect(kb.type).toBe('tg-reply-keyboard');
    expect(kb.props.resizeKeyboard).toBe(true);
    const row = kb.children[0];
    expect(row.type).toBe('tg-reply-row');
    const btn = row.children[0];
    expect(btn.type).toBe('tg-reply-button');
    expect(btn.props.text).toBe('Option A');
  });

  test('ReplyKeyboard supports multiple rows', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Choose:">
        <ReplyKeyboard>
          <ReplyRow>
            <ReplyButton text="A" />
            <ReplyButton text="B" />
          </ReplyRow>
          <ReplyRow>
            <ReplyButton text="C" />
          </ReplyRow>
        </ReplyKeyboard>
      </Message>,
    );
    await waitForCommit();

    const kb = output!.children[0];
    expect(kb.children).toHaveLength(2);
    expect(kb.children[0].children).toHaveLength(2);
    expect(kb.children[1].children).toHaveLength(1);
  });

  test('ReplyKeyboard passes oneTimeKeyboard prop', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="One time:">
        <ReplyKeyboard oneTimeKeyboard>
          <ReplyRow>
            <ReplyButton text="X" />
          </ReplyRow>
        </ReplyKeyboard>
      </Message>,
    );
    await waitForCommit();

    const kb = output!.children[0];
    expect(kb.props.oneTimeKeyboard).toBe(true);
  });

  test('ReplyKeyboard passes placeholder prop', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Placeholder:">
        <ReplyKeyboard placeholder="Type here...">
          <ReplyRow>
            <ReplyButton text="Y" />
          </ReplyRow>
        </ReplyKeyboard>
      </Message>,
    );
    await waitForCommit();

    const kb = output!.children[0];
    expect(kb.props.placeholder).toBe('Type here...');
  });

  test('RequestContactButton sets requestContact flag', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Share:">
        <ReplyKeyboard>
          <ReplyRow>
            <RequestContactButton text="Share Contact" />
          </ReplyRow>
        </ReplyKeyboard>
      </Message>,
    );
    await waitForCommit();

    const btn = output!.children[0].children[0].children[0];
    expect(btn.type).toBe('tg-reply-button');
    expect(btn.props.text).toBe('Share Contact');
    expect(btn.props.requestContact).toBe(true);
  });

  test('ReplyKeyboardRemove renders correctly', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Removed">
        <ReplyKeyboardRemove />
      </Message>,
    );
    await waitForCommit();

    const remove = output!.children[0];
    expect(remove.type).toBe('tg-reply-keyboard-remove');
  });
});

describe('ReplyKeyboard serialization', () => {
  test('serializes ReplyKeyboard with rows and buttons', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Pick:' },
      children: [{
        type: 'tg-reply-keyboard',
        props: { resizeKeyboard: true, oneTimeKeyboard: false },
        children: [{
          type: 'tg-reply-row',
          props: {},
          children: [
            { type: 'tg-reply-button', props: { text: 'Alpha' }, children: [] },
            { type: 'tg-reply-button', props: { text: 'Beta' }, children: [] },
          ],
        }],
      }],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendMessage');
    expect(payload.text).toBe('Pick:');
    expect(payload.replyKeyboard).toBeTruthy();
    expect(payload.replyKeyboard!.rows).toHaveLength(1);
    expect(payload.replyKeyboard!.rows[0]).toHaveLength(2);
    expect((payload.replyKeyboard!.rows[0][0] as any).text).toBe('Alpha');
    expect((payload.replyKeyboard!.rows[0][1] as any).text).toBe('Beta');
    expect(payload.replyKeyboard!.resizeKeyboard).toBe(true);
  });

  test('serializes RequestContactButton with request_contact', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Share contact' },
      children: [{
        type: 'tg-reply-keyboard',
        props: { resizeKeyboard: true },
        children: [{
          type: 'tg-reply-row',
          props: {},
          children: [
            { type: 'tg-reply-button', props: { text: 'Share', requestContact: true }, children: [] },
          ],
        }],
      }],
    };

    const payload = serializeOutput(node);
    expect((payload.replyKeyboard!.rows[0][0] as any).text).toBe('Share');
    expect((payload.replyKeyboard!.rows[0][0] as any).request_contact).toBe(true);
  });

  test('serializes ReplyKeyboardRemove with removeKeyboard flag', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Done' },
      children: [
        { type: 'tg-reply-keyboard-remove', props: {}, children: [] },
      ],
    };

    const payload = serializeOutput(node);
    expect(payload.removeKeyboard).toBe(true);
    expect(payload.text).toBe('Done');
  });

  test('serializes ReplyKeyboard with placeholder', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Type:' },
      children: [{
        type: 'tg-reply-keyboard',
        props: { resizeKeyboard: true, placeholder: 'Enter text...' },
        children: [{
          type: 'tg-reply-row',
          props: {},
          children: [
            { type: 'tg-reply-button', props: { text: 'Go' }, children: [] },
          ],
        }],
      }],
    };

    const payload = serializeOutput(node);
    expect(payload.replyKeyboard!.placeholder).toBe('Enter text...');
  });

  test('serializes multiple reply keyboard rows', () => {
    const node: OutputNode = {
      type: 'tg-message',
      props: { text: 'Multi:' },
      children: [{
        type: 'tg-reply-keyboard',
        props: { resizeKeyboard: true },
        children: [
          {
            type: 'tg-reply-row',
            props: {},
            children: [
              { type: 'tg-reply-button', props: { text: 'R1B1' }, children: [] },
            ],
          },
          {
            type: 'tg-reply-row',
            props: {},
            children: [
              { type: 'tg-reply-button', props: { text: 'R2B1' }, children: [] },
              { type: 'tg-reply-button', props: { text: 'R2B2' }, children: [] },
            ],
          },
        ],
      }],
    };

    const payload = serializeOutput(node);
    expect(payload.replyKeyboard!.rows).toHaveLength(2);
    expect(payload.replyKeyboard!.rows[0]).toHaveLength(1);
    expect(payload.replyKeyboard!.rows[1]).toHaveLength(2);
    expect((payload.replyKeyboard!.rows[1][1] as any).text).toBe('R2B2');
  });
});
