import { describe, test, expect } from 'bun:test';
import React from 'react';
import { createRoot, type OutputNode } from '../packages/renderer/src';
import {
  Video, Animation, Voice, Audio, VideoNote, Sticker,
  Contact, Location, LiveLocation, Venue,
  MediaGroup, MediaPhoto, MediaVideo,
  ReplyKeyboard, ReplyRow, ReplyButton, RequestContactButton, RequestLocationButton,
  Notification, WebAppButton,
  Message, InlineKeyboard, Button, ButtonRow, Photo, Document,
  Bold, Italic, Code, List, ListItem,
} from '../packages/react/src';

function waitForCommit(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

// ---- Media Components ----

describe('Video component', () => {
  test('renders with all props', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Video src="video.mp4" caption="My video" duration={30} width={1920} height={1080} supportsStreaming />);
    await waitForCommit();
    expect(output!.type).toBe('tg-video');
    expect(output!.props.src).toBe('video.mp4');
    expect(output!.props.caption).toBe('My video');
    expect(output!.props.duration).toBe(30);
    expect(output!.props.width).toBe(1920);
    expect(output!.props.height).toBe(1080);
    expect(output!.props.supportsStreaming).toBe(true);
  });

  test('renders with minimal props', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Video src="vid.mp4" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-video');
    expect(output!.props.src).toBe('vid.mp4');
  });
});

describe('Animation component', () => {
  test('renders gif', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Animation src="anim.gif" caption="Funny" width={320} height={240} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-animation');
    expect(output!.props.src).toBe('anim.gif');
    expect(output!.props.caption).toBe('Funny');
  });
});

describe('Voice component', () => {
  test('renders voice message', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Voice src="voice.ogg" caption="Listen" duration={15} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-voice');
    expect(output!.props.src).toBe('voice.ogg');
    expect(output!.props.duration).toBe(15);
  });
});

describe('Audio component', () => {
  test('renders with performer and title', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Audio src="song.mp3" performer="Artist" title="Track" duration={180} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-audio');
    expect(output!.props.performer).toBe('Artist');
    expect(output!.props.title).toBe('Track');
    expect(output!.props.duration).toBe(180);
  });
});

describe('VideoNote component', () => {
  test('renders round video', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<VideoNote src="vnote.mp4" duration={10} length={240} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-video-note');
    expect(output!.props.src).toBe('vnote.mp4');
    expect(output!.props.length).toBe(240);
  });
});

describe('Sticker component', () => {
  test('renders sticker', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Sticker src="sticker.webp" emoji="🎉" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-sticker');
    expect(output!.props.emoji).toBe('🎉');
  });
});

// ---- Data Components ----

describe('Contact component', () => {
  test('renders with all props', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Contact phoneNumber="+1234567890" firstName="John" lastName="Doe" vcard="BEGIN:VCARD" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-contact');
    expect(output!.props.phoneNumber).toBe('+1234567890');
    expect(output!.props.firstName).toBe('John');
    expect(output!.props.lastName).toBe('Doe');
    expect(output!.props.vcard).toBe('BEGIN:VCARD');
  });
});

describe('Location component', () => {
  test('renders basic location', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Location latitude={37.7749} longitude={-122.4194} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-location');
    expect(output!.props.latitude).toBe(37.7749);
    expect(output!.props.longitude).toBe(-122.4194);
  });

  test('LiveLocation renders with livePeriod', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<LiveLocation latitude={40.7} longitude={-74.0} livePeriod={600} heading={90} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-location');
    expect(output!.props.livePeriod).toBe(600);
    expect(output!.props.heading).toBe(90);
  });

  test('Location.Live compound works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Location.Live latitude={51.5} longitude={-0.1} livePeriod={300} />);
    await waitForCommit();
    expect(output!.type).toBe('tg-location');
    expect(output!.props.livePeriod).toBe(300);
  });
});

describe('Venue component', () => {
  test('renders venue', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Venue latitude={48.8566} longitude={2.3522} title="Eiffel Tower" address="Paris, France" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-venue');
    expect(output!.props.title).toBe('Eiffel Tower');
    expect(output!.props.address).toBe('Paris, France');
  });

  test('Location.Venue compound works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Location.Venue latitude={0} longitude={0} title="Place" address="Addr" />);
    await waitForCommit();
    expect(output!.type).toBe('tg-venue');
  });
});

// ---- MediaGroup ----

describe('MediaGroup component', () => {
  test('renders with children', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <MediaGroup>
        <MediaPhoto src="a.jpg" caption="First" />
        <MediaVideo src="b.mp4" caption="Second" />
      </MediaGroup>,
    );
    await waitForCommit();
    expect(output!.type).toBe('tg-media-group');
    expect(output!.children).toHaveLength(2);
    expect(output!.children[0].type).toBe('tg-media-photo');
    expect(output!.children[1].type).toBe('tg-media-video');
  });

  test('MediaGroup.Photo compound works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <MediaGroup>
        <MediaGroup.Photo src="x.jpg" />
        <MediaGroup.Video src="y.mp4" />
      </MediaGroup>,
    );
    await waitForCommit();
    expect(output!.children).toHaveLength(2);
  });

  test('MediaPhoto outside MediaGroup throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };
    const root = createRoot(() => {});
    root.render(<MediaPhoto src="x.jpg" />);
    await waitForCommit();
    console.error = origError;
    expect(errors.some(e => e.message.includes('must be used inside <MediaGroup>'))).toBe(true);
  });

  test('MediaVideo outside MediaGroup throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };
    const root = createRoot(() => {});
    root.render(<MediaVideo src="x.mp4" />);
    await waitForCommit();
    console.error = origError;
    expect(errors.some(e => e.message.includes('must be used inside <MediaGroup>'))).toBe(true);
  });
});

// ---- ReplyKeyboard ----

describe('ReplyKeyboard component', () => {
  test('renders with rows and buttons', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <ReplyKeyboard resizeKeyboard oneTimeKeyboard placeholder="Choose...">
        <ReplyRow>
          <ReplyButton text="Option A" />
          <ReplyButton text="Option B" />
        </ReplyRow>
        <ReplyRow>
          <RequestContactButton text="Share Phone" />
          <RequestLocationButton text="Share Location" />
        </ReplyRow>
      </ReplyKeyboard>,
    );
    await waitForCommit();
    expect(output!.type).toBe('tg-reply-keyboard');
    expect(output!.props.resizeKeyboard).toBe(true);
    expect(output!.props.oneTimeKeyboard).toBe(true);
    expect(output!.props.placeholder).toBe('Choose...');
    expect(output!.children).toHaveLength(2);
    const row1 = output!.children[0];
    expect(row1.type).toBe('tg-reply-row');
    expect(row1.children[0].props.text).toBe('Option A');
    const row2 = output!.children[1];
    expect(row2.children[0].props.requestContact).toBe(true);
    expect(row2.children[1].props.requestLocation).toBe(true);
  });

  test('compound ReplyKeyboard.Row works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <ReplyKeyboard>
        <ReplyKeyboard.Row>
          <ReplyKeyboard.Button text="Hi" />
        </ReplyKeyboard.Row>
      </ReplyKeyboard>,
    );
    await waitForCommit();
    expect(output!.children[0].type).toBe('tg-reply-row');
    expect(output!.children[0].children[0].props.text).toBe('Hi');
  });

  test('ReplyButton outside ReplyKeyboard throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };
    const root = createRoot(() => {});
    root.render(<ReplyButton text="Bad" />);
    await waitForCommit();
    console.error = origError;
    expect(errors.some(e => e.message.includes('must be used inside <ReplyKeyboard>'))).toBe(true);
  });

  test('ReplyRow outside ReplyKeyboard throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };
    const root = createRoot(() => {});
    root.render(<ReplyRow><ReplyButton text="Bad" /></ReplyRow>);
    await waitForCommit();
    console.error = origError;
    expect(errors.some(e => e.message.includes('must be used inside <ReplyKeyboard>'))).toBe(true);
  });

  test('RequestContactButton outside ReplyKeyboard throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };
    const root = createRoot(() => {});
    root.render(<RequestContactButton text="Bad" />);
    await waitForCommit();
    console.error = origError;
    expect(errors.some(e => e.message.includes('must be used inside <ReplyKeyboard>'))).toBe(true);
  });
});

// ---- Notification ----

describe('Notification component', () => {
  test('renders notification', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(<Notification text="Saved!" showAlert />);
    await waitForCommit();
    expect(output!.type).toBe('tg-notification');
    expect(output!.props.text).toBe('Saved!');
    expect(output!.props.showAlert).toBe(true);
  });
});

// ---- WebApp Button ----

describe('WebAppButton component', () => {
  test('renders webapp button inside keyboard', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Test">
        <InlineKeyboard>
          <ButtonRow>
            <WebAppButton text="Open App" url="https://example.com/app" />
          </ButtonRow>
        </InlineKeyboard>
      </Message>,
    );
    await waitForCommit();
    const btn = output!.children[0].children[0].children[0];
    expect(btn.type).toBe('tg-button');
    expect(btn.props.webAppUrl).toBe('https://example.com/app');
  });

  test('Button.WebApp compound works', async () => {
    let output: OutputNode | null = null;
    const root = createRoot((tree) => { output = tree; });
    root.render(
      <Message text="Test">
        <InlineKeyboard>
          <ButtonRow>
            <Button.WebApp text="Web" url="https://example.com" />
          </ButtonRow>
        </InlineKeyboard>
      </Message>,
    );
    await waitForCommit();
    const btn = output!.children[0].children[0].children[0];
    expect(btn.props.webAppUrl).toBe('https://example.com');
  });

  test('WebAppButton outside InlineKeyboard throws', async () => {
    const errors: Error[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] instanceof Error) errors.push(args[0]);
      else if (typeof args[0] === 'string' && args.length > 1 && args[1] instanceof Error) errors.push(args[1]);
    };
    const root = createRoot(() => {});
    root.render(<WebAppButton text="Bad" url="https://example.com" />);
    await waitForCommit();
    console.error = origError;
    expect(errors.some(e => e.message.includes('must be used inside <InlineKeyboard>'))).toBe(true);
  });
});

// ---- Compound Component Patterns ----

describe('Compound component patterns', () => {
  test('Message.Bold is Bold', () => {
    expect(Message.Bold).toBe(Bold);
  });

  test('Message.Italic is Italic', () => {
    expect(Message.Italic).toBe(Italic);
  });

  test('Message.Code is Code', () => {
    expect(Message.Code).toBe(Code);
  });

  test('InlineKeyboard.Row is ButtonRow', () => {
    expect(InlineKeyboard.Row).toBe(ButtonRow);
  });

  test('InlineKeyboard.Button is Button', () => {
    expect(InlineKeyboard.Button).toBe(Button);
  });

  test('Button.Row is ButtonRow', () => {
    expect(Button.Row).toBe(ButtonRow);
  });

  test('Button.WebApp is WebAppButton', () => {
    expect(Button.WebApp).toBe(WebAppButton);
  });

  test('Location.Live is LiveLocation', () => {
    expect(Location.Live).toBe(LiveLocation);
  });

  test('Location.Venue is Venue', () => {
    expect(Location.Venue).toBe(Venue);
  });

  test('MediaGroup.Photo is MediaPhoto', () => {
    expect(MediaGroup.Photo).toBe(MediaPhoto);
  });

  test('MediaGroup.Video is MediaVideo', () => {
    expect(MediaGroup.Video).toBe(MediaVideo);
  });

  test('ReplyKeyboard.Row is ReplyRow', () => {
    expect(ReplyKeyboard.Row).toBe(ReplyRow);
  });

  test('ReplyKeyboard.Button is ReplyButton', () => {
    expect(ReplyKeyboard.Button).toBe(ReplyButton);
  });

  test('ReplyKeyboard.RequestContact is RequestContactButton', () => {
    expect(ReplyKeyboard.RequestContact).toBe(RequestContactButton);
  });

  test('ReplyKeyboard.RequestLocation is RequestLocationButton', () => {
    expect(ReplyKeyboard.RequestLocation).toBe(RequestLocationButton);
  });

  test('List.Item is ListItem', () => {
    expect(List.Item).toBe(ListItem);
  });
});
