import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/core/src/renderer';
import {
  Photo, Video, Document, InlineKeyboard, ButtonRow, Button,
} from '../packages/ui/src/components';
import { serializeOutput } from '../packages/telegram/src/serialize';

const waitForCommit = (ms = 15) => new Promise<void>(r => setTimeout(r, ms));

describe('Photo with InlineKeyboard children', () => {
  test('renders Photo with InlineKeyboard child', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Photo src="https://example.com/pic.jpg" caption="A photo">
        <InlineKeyboard>
          <ButtonRow>
            <Button text="Like" onClick="like" />
          </ButtonRow>
        </InlineKeyboard>
      </Photo>,
    );
    await waitForCommit();

    expect(output).toBeTruthy();
    expect(output!.type).toBe('tg-photo');
    expect(output!.props.src).toBe('https://example.com/pic.jpg');
    const kb = output!.children[0];
    expect(kb.type).toBe('tg-keyboard');
  });

  test('serializes Photo with InlineKeyboard keyboard field', () => {
    const node: OutputNode = {
      type: 'tg-photo',
      props: { src: 'https://example.com/pic.jpg', caption: 'Nice photo' },
      children: [{
        type: 'tg-keyboard',
        props: {},
        children: [{
          type: 'tg-button-row',
          props: {},
          children: [
            { type: 'tg-button', props: { text: 'Like', callbackData: 'like' }, children: [] },
            { type: 'tg-button', props: { text: 'Share', callbackData: 'share' }, children: [] },
          ],
        }],
      }],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendPhoto');
    expect(payload.photo).toBe('https://example.com/pic.jpg');
    expect(payload.text).toBe('Nice photo');
    expect(payload.keyboard).toBeTruthy();
    expect(payload.keyboard!).toHaveLength(1);
    expect(payload.keyboard![0]).toHaveLength(2);
    expect(payload.keyboard![0][0].text).toBe('Like');
    expect((payload.keyboard![0][0] as any).callback_data).toBe('like');
  });

  test('serializes Photo with hasSpoiler', () => {
    const node: OutputNode = {
      type: 'tg-photo',
      props: { src: 'photo.jpg', hasSpoiler: true },
      children: [],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendPhoto');
    expect(payload.hasSpoiler).toBe(true);
  });
});

describe('Video with InlineKeyboard children', () => {
  test('renders Video with InlineKeyboard child', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Video src="https://example.com/video.mp4" caption="A video">
        <InlineKeyboard>
          <ButtonRow>
            <Button text="Watch" onClick="watch" />
          </ButtonRow>
        </InlineKeyboard>
      </Video>,
    );
    await waitForCommit();

    expect(output).toBeTruthy();
    expect(output!.type).toBe('tg-video');
    expect(output!.children[0].type).toBe('tg-keyboard');
  });

  test('serializes Video with keyboard field', () => {
    const node: OutputNode = {
      type: 'tg-video',
      props: { src: 'video.mp4', caption: 'Watch this', width: 1280, height: 720, duration: 60 },
      children: [{
        type: 'tg-keyboard',
        props: {},
        children: [{
          type: 'tg-button-row',
          props: {},
          children: [
            { type: 'tg-button', props: { text: 'Play', callbackData: 'play' }, children: [] },
          ],
        }],
      }],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendVideo');
    expect(payload.video).toBe('video.mp4');
    expect(payload.text).toBe('Watch this');
    expect(payload.width).toBe(1280);
    expect(payload.height).toBe(720);
    expect(payload.duration).toBe(60);
    expect(payload.keyboard).toBeTruthy();
    expect(payload.keyboard![0][0].text).toBe('Play');
  });

  test('serializes Video with supportsStreaming and hasSpoiler', () => {
    const node: OutputNode = {
      type: 'tg-video',
      props: { src: 'vid.mp4', supportsStreaming: true, hasSpoiler: true },
      children: [],
    };

    const payload = serializeOutput(node);
    expect(payload.supportsStreaming).toBe(true);
    expect(payload.hasSpoiler).toBe(true);
  });
});

describe('Document with children', () => {
  test('renders Document with InlineKeyboard child', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Document src="file.pdf" caption="Report" filename="report.pdf">
        <InlineKeyboard>
          <ButtonRow>
            <Button text="Download" url="https://example.com/file.pdf" />
          </ButtonRow>
        </InlineKeyboard>
      </Document>,
    );
    await waitForCommit();

    expect(output).toBeTruthy();
    expect(output!.type).toBe('tg-document');
    expect(output!.props.filename).toBe('report.pdf');
    expect(output!.children[0].type).toBe('tg-keyboard');
  });

  test('serializes Document with keyboard field', () => {
    const node: OutputNode = {
      type: 'tg-document',
      props: { src: 'report.pdf', caption: 'Q4 Report', filename: 'report.pdf' },
      children: [{
        type: 'tg-keyboard',
        props: {},
        children: [{
          type: 'tg-button-row',
          props: {},
          children: [
            { type: 'tg-button', props: { text: 'Open', url: 'https://example.com/report.pdf' }, children: [] },
          ],
        }],
      }],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendDocument');
    expect(payload.document).toBe('report.pdf');
    expect(payload.text).toBe('Q4 Report');
    expect(payload.filename).toBe('report.pdf');
    expect(payload.keyboard).toBeTruthy();
    expect(payload.keyboard![0][0].text).toBe('Open');
    expect((payload.keyboard![0][0] as any).url).toBe('https://example.com/report.pdf');
  });

  test('serializes Document without children', () => {
    const node: OutputNode = {
      type: 'tg-document',
      props: { src: 'notes.txt', caption: 'Notes' },
      children: [],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendDocument');
    expect(payload.document).toBe('notes.txt');
    expect(payload.text).toBe('Notes');
    expect(payload.keyboard).toBeUndefined();
  });
});

describe('Photo without children', () => {
  test('serializes Photo without keyboard', () => {
    const node: OutputNode = {
      type: 'tg-photo',
      props: { src: 'pic.jpg', caption: 'Just a pic' },
      children: [],
    };

    const payload = serializeOutput(node);
    expect(payload.method).toBe('sendPhoto');
    expect(payload.photo).toBe('pic.jpg');
    expect(payload.keyboard).toBeUndefined();
  });

  test('serializes Photo with parseMode', () => {
    const node: OutputNode = {
      type: 'tg-photo',
      props: { src: 'pic.jpg', caption: '<b>Bold</b>', parseMode: 'HTML' },
      children: [],
    };

    const payload = serializeOutput(node);
    expect(payload.parseMode).toBe('HTML');
  });
});
