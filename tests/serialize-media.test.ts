import { describe, test, expect } from 'bun:test';
import { serializeOutput } from '../packages/telegram/src/serialize';
import type { OutputNode } from '../packages/core/src/renderer';

describe('Serialize Video', () => {
  test('serializes video with all props', () => {
    const node: OutputNode = {
      type: 'tg-video', props: { src: 'video.mp4', caption: 'My vid', parseMode: 'HTML', width: 1920, height: 1080, duration: 30, supportsStreaming: true, hasSpoiler: true }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendVideo');
    expect(r.video).toBe('video.mp4');
    expect(r.text).toContain('My vid');
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
    expect(r.duration).toBe(30);
    expect(r.supportsStreaming).toBe(true);
    expect(r.hasSpoiler).toBe(true);
  });
});

describe('Serialize Animation', () => {
  test('serializes animation', () => {
    const node: OutputNode = {
      type: 'tg-animation', props: { src: 'anim.gif', caption: 'Funny', width: 320, height: 240 }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendAnimation');
    expect(r.animation).toBe('anim.gif');
    expect(r.text).toContain('Funny');
  });
});

describe('Serialize Voice', () => {
  test('serializes voice', () => {
    const node: OutputNode = {
      type: 'tg-voice', props: { src: 'v.ogg', caption: 'Listen', duration: 15 }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendVoice');
    expect(r.voice).toBe('v.ogg');
    expect(r.duration).toBe(15);
  });
});

describe('Serialize Audio', () => {
  test('serializes audio with performer/title', () => {
    const node: OutputNode = {
      type: 'tg-audio', props: { src: 'song.mp3', caption: 'Great', performer: 'Artist', title: 'Track', duration: 180 }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendAudio');
    expect(r.audio).toBe('song.mp3');
    expect(r.performer).toBe('Artist');
    expect(r.title).toBe('Track');
  });
});

describe('Serialize VideoNote', () => {
  test('serializes video note', () => {
    const node: OutputNode = {
      type: 'tg-video-note', props: { src: 'vnote.mp4', duration: 10, length: 240 }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendVideoNote');
    expect(r.videoNote).toBe('vnote.mp4');
    expect(r.length).toBe(240);
  });
});

describe('Serialize Sticker', () => {
  test('serializes sticker', () => {
    const node: OutputNode = {
      type: 'tg-sticker', props: { src: 'sticker.webp', emoji: '🎉' }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendSticker');
    expect(r.sticker).toBe('sticker.webp');
    expect(r.emoji).toBe('🎉');
  });
});

describe('Serialize Contact', () => {
  test('serializes contact', () => {
    const node: OutputNode = {
      type: 'tg-contact', props: { phoneNumber: '+123', firstName: 'John', lastName: 'Doe', vcard: 'vc' }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendContact');
    expect(r.phoneNumber).toBe('+123');
    expect(r.firstName).toBe('John');
    expect(r.lastName).toBe('Doe');
    expect(r.vcard).toBe('vc');
  });
});

describe('Serialize Location', () => {
  test('serializes basic location', () => {
    const node: OutputNode = {
      type: 'tg-location', props: { latitude: 37.77, longitude: -122.42 }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendLocation');
    expect(r.latitude).toBe(37.77);
    expect(r.longitude).toBe(-122.42);
  });

  test('serializes live location', () => {
    const node: OutputNode = {
      type: 'tg-location', props: { latitude: 40.7, longitude: -74.0, livePeriod: 600, heading: 90, proximityAlertRadius: 100 }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendLocation');
    expect(r.livePeriod).toBe(600);
    expect(r.heading).toBe(90);
    expect(r.proximityAlertRadius).toBe(100);
  });
});

describe('Serialize Venue', () => {
  test('serializes venue', () => {
    const node: OutputNode = {
      type: 'tg-venue', props: { latitude: 48.85, longitude: 2.35, title: 'Eiffel', address: 'Paris', foursquareId: 'fs123' }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendVenue');
    expect(r.venueTitle).toBe('Eiffel');
    expect(r.venueAddress).toBe('Paris');
    expect(r.foursquareId).toBe('fs123');
  });
});

describe('Serialize MediaGroup', () => {
  test('serializes media group', () => {
    const node: OutputNode = {
      type: 'tg-media-group', props: {}, children: [
        { type: 'tg-media-photo', props: { src: 'a.jpg', caption: 'Photo A', hasSpoiler: true }, children: [] },
        { type: 'tg-media-video', props: { src: 'b.mp4', caption: 'Video B', width: 1920, supportsStreaming: true }, children: [] },
      ],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendMediaGroup');
    expect(r.mediaGroup).toHaveLength(2);
    expect(r.mediaGroup![0].type).toBe('photo');
    expect(r.mediaGroup![0].media).toBe('a.jpg');
    expect(r.mediaGroup![0].has_spoiler).toBe(true);
    expect(r.mediaGroup![1].type).toBe('video');
    expect(r.mediaGroup![1].width).toBe(1920);
    expect(r.mediaGroup![1].supports_streaming).toBe(true);
  });
});

describe('Serialize ReplyKeyboard', () => {
  test('serializes reply keyboard with rows', () => {
    const node: OutputNode = {
      type: 'tg-reply-keyboard', props: { resizeKeyboard: true, oneTimeKeyboard: true, placeholder: 'Choose...' }, children: [
        {
          type: 'tg-reply-row', props: {}, children: [
            { type: 'tg-reply-button', props: { text: 'A' }, children: [] },
            { type: 'tg-reply-button', props: { text: 'B' }, children: [] },
          ],
        },
        {
          type: 'tg-reply-row', props: {}, children: [
            { type: 'tg-reply-button', props: { text: 'Share Phone', requestContact: true }, children: [] },
            { type: 'tg-reply-button', props: { text: 'Share Location', requestLocation: true }, children: [] },
          ],
        },
      ],
    };
    const r = serializeOutput(node);
    expect(r.replyKeyboard).toBeDefined();
    expect(r.replyKeyboard!.rows).toHaveLength(2);
    expect((r.replyKeyboard!.rows[0][0] as any).text).toBe('A');
    expect((r.replyKeyboard!.rows[0][1] as any).text).toBe('B');
    expect((r.replyKeyboard!.rows[1][0] as any).request_contact).toBe(true);
    expect((r.replyKeyboard!.rows[1][1] as any).request_location).toBe(true);
    expect(r.replyKeyboard!.resizeKeyboard).toBe(true);
    expect(r.replyKeyboard!.oneTimeKeyboard).toBe(true);
    expect(r.replyKeyboard!.placeholder).toBe('Choose...');
  });

  test('standalone reply buttons create single-button rows', () => {
    const node: OutputNode = {
      type: 'tg-reply-keyboard', props: { resizeKeyboard: true }, children: [
        { type: 'tg-reply-button', props: { text: 'Standalone' }, children: [] },
      ],
    };
    const r = serializeOutput(node);
    expect(r.replyKeyboard!.rows).toHaveLength(1);
    expect((r.replyKeyboard!.rows[0][0] as any).text).toBe('Standalone');
  });
});

describe('Serialize Notification', () => {
  test('serializes notification', () => {
    const node: OutputNode = {
      type: 'tg-notification', props: { text: 'Saved!', showAlert: true }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.notification).toBeDefined();
    expect(r.notification!.text).toBe('Saved!');
    expect(r.notification!.showAlert).toBe(true);
  });
});

describe('Serialize WebApp button', () => {
  test('serializes button with webAppUrl', () => {
    const node: OutputNode = {
      type: 'tg-button', props: { text: 'Open App', webAppUrl: 'https://example.com/app' }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.keyboard).toHaveLength(1);
    expect((r.keyboard![0][0] as any).web_app).toEqual({ url: 'https://example.com/app' });
  });
});

describe('Serialize Photo with spoiler', () => {
  test('serializes photo hasSpoiler', () => {
    const node: OutputNode = {
      type: 'tg-photo', props: { src: 'pic.jpg', hasSpoiler: true }, children: [],
    };
    const r = serializeOutput(node);
    expect(r.method).toBe('sendPhoto');
    expect(r.hasSpoiler).toBe(true);
  });
});
