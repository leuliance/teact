import React from 'react';
import { useNavigate, useOn, useBot } from '@teact/core';
import {
  Message, InlineKeyboard, Button, Alert, List, Divider,
} from '@teact/ui';
import { defineConversation } from '@teact/telegram';

const PIKACHU_ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png';
const CHARIZARD_ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png';
const BULBASAUR_ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png';
const SAMPLE_VIDEO = 'https://www.w3schools.com/html/mov_bbb.mp4';
const SAMPLE_GIF = 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif';
const SAMPLE_AUDIO = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

const showcase = defineConversation('showcase', async (conversation) => {
  await conversation.send(
    '📘 Component Showcase\n\n' +
    'Welcome! I\'ll walk you through every Teact component.\n' +
    'Each step will actually send the component so you can see it in action.',
  );

  await conversation.ask('Ready?', [[{ text: '▸ Start', value: 'go' }]]);

  await conversation.send('📷 Step 1/10: Photo\nSending a photo with caption...');
  await conversation.replyWithPhoto(PIKACHU_ART, {
    caption: 'Pikachu — sent via conversation.replyWithPhoto()',
  });

  await conversation.ask('Next?', [[{ text: '▸ Video', value: 'next' }]]);

  await conversation.send('🎬 Step 2/10: Video\nSending a video...');
  await conversation.replyWithVideo(SAMPLE_VIDEO, {
    caption: 'Sample video — conversation.replyWithVideo()',
    supports_streaming: true,
  });

  await conversation.ask('Next?', [[{ text: '▸ Animation (GIF)', value: 'next' }]]);

  await conversation.send('🎞 Step 3/10: Animation (GIF)\nSending a GIF...');
  await conversation.replyWithAnimation(SAMPLE_GIF, {
    caption: 'GIF — conversation.replyWithAnimation()',
  });

  await conversation.ask('Next?', [[{ text: '▸ Audio', value: 'next' }]]);

  await conversation.send('🎵 Step 4/10: Audio\nSending an audio file with metadata...');
  await conversation.replyWithAudio(SAMPLE_AUDIO, {
    caption: 'Audio — conversation.replyWithAudio()',
    performer: 'SoundHelix',
    title: 'Song 1',
  });

  await conversation.ask('Next?', [[{ text: '▸ Document', value: 'next' }]]);

  await conversation.send('📄 Step 5/10: Document\nSending a file...');
  await conversation.replyWithDocument(PIKACHU_ART, {
    caption: 'Image as document — conversation.replyWithDocument()',
  });

  await conversation.ask('Next?', [[{ text: '▸ Contact', value: 'next' }]]);

  await conversation.send('👤 Step 6/10: Contact\nSending a contact card...');
  await conversation.replyWithContact('+1234567890', 'Ash', {
    last_name: 'Ketchum',
  });

  await conversation.ask('Next?', [[{ text: '▸ Location', value: 'next' }]]);

  await conversation.send('📍 Step 7/10: Location\nSending a location pin...');
  await conversation.replyWithLocation(35.6762, 139.6503);

  await conversation.send('🏛 And a venue...');
  await conversation.replyWithVenue(35.6762, 139.6503, 'Pokemon Center Tokyo', 'Nihonbashi, Chuo City, Tokyo');

  await conversation.ask('Next?', [[{ text: '▸ Media Group', value: 'next' }]]);

  await conversation.send('🖼 Step 8/10: Media Group\nSending an album of photos...');
  await conversation.replyWithMediaGroup([
    { type: 'photo', media: PIKACHU_ART, caption: 'Pikachu' },
    { type: 'photo', media: CHARIZARD_ART, caption: 'Charizard' },
    { type: 'photo', media: BULBASAUR_ART, caption: 'Bulbasaur' },
  ]);

  await conversation.ask('Next?', [[{ text: '▸ Sticker', value: 'next' }]]);

  await conversation.send(
    '🎉 Step 9/10: Sticker\n' +
    'Usage: conversation.replyWithSticker(fileId)\n' +
    '(Requires a valid sticker file_id from Telegram)',
  );

  await conversation.ask('Next?', [[{ text: '▸ Summary', value: 'next' }]]);

  await conversation.send(
    '🧩 Step 10/10: Component Recap\n\n' +
    'Conversation API:\n' +
    '  conversation.send(text)\n' +
    '  conversation.replyWithPhoto(src, opts)\n' +
    '  conversation.replyWithVideo(src, opts)\n' +
    '  conversation.replyWithAnimation(src, opts)\n' +
    '  conversation.replyWithAudio(src, opts)\n' +
    '  conversation.replyWithVoice(src, opts)\n' +
    '  conversation.replyWithVideoNote(src, opts)\n' +
    '  conversation.replyWithSticker(src, opts)\n' +
    '  conversation.replyWithDocument(src, opts)\n' +
    '  conversation.replyWithContact(phone, name, opts)\n' +
    '  conversation.replyWithLocation(lat, lng, opts)\n' +
    '  conversation.replyWithVenue(lat, lng, title, addr, opts)\n' +
    '  conversation.replyWithMediaGroup(media)\n' +
    '  conversation.chatId / conversation.api / conversation.chat\n\n' +
    'React Hooks:\n' +
    '  useChat() — chat info\n' +
    '  useTelegram() — raw API access\n' +
    '  usePhoto() — send photo\n' +
    '  useVideo() — send video\n' +
    '  useAudio() — send audio\n' +
    '  useVoice() — send voice\n' +
    '  useLocation() — send location\n' +
    '  useContact() — send contact\n\n' +
    'JSX Components:\n' +
    '  Message.Bold, Message.Italic, Message.Code\n' +
    '  InlineKeyboard.Row, InlineKeyboard.Button\n' +
    '  Button.Row, Button.WebApp\n' +
    '  Location.Live, Location.Venue\n' +
    '  MediaGroup.Photo, MediaGroup.Video\n' +
    '  ReplyKeyboard.Row, ReplyKeyboard.Button\n' +
    '  ReplyKeyboard.RequestContact, ReplyKeyboard.RequestLocation\n' +
    '  List.Item\n\n' +
    '✅ Tour complete! Use /start to go back.',
  );
});

export function ComponentShowcase() {
  const navigate = useNavigate();
  const bot = useBot();

  useOn('*', (data, ctx) => {
    const type = data?.message ? 'message' : data?.callbackQuery ? 'callback' : 'other';
    const preview = data?.message?.text ?? data?.callbackQuery?.data ?? '—';
    console.log(`[showcase] ${type} from ${ctx.user.firstName}: ${preview}`);
  });

  useOn('photo', (photo, ctx) => {
    console.log(`[showcase] 📷 Photo from ${ctx.user.firstName}: ${photo?.length} sizes`);
  });

  useOn('document', (doc, ctx) => {
    console.log(`[showcase] 📎 File from ${ctx.user.firstName}: ${doc?.file_name} (${doc?.mime_type})`);
  });

  return (
    <Message text={'🧪 Component Showcase\n\nExplore every Teact component in a guided tour.\nButtons below demo URL openers, Mini Apps, deep links, and navigate modes.'}>
      <InlineKeyboard>
        <InlineKeyboard.Row>
          <Button text="▸ Start Tour" conversation={showcase} variant="primary" />
        </InlineKeyboard.Row>
        <InlineKeyboard.Row>
          <Button text="🌐 Open URL" url="https://telegram.org" />
          <Button.WebApp text="🚀 Mini App" url="https://webappcontent.telegram.org/cafe" />
        </InlineKeyboard.Row>
        <InlineKeyboard.Row>
          <Button text="📤 Deep Link → Pikachu" url={`https://t.me/${bot.botUsername}?start=comments-25`} />
        </InlineKeyboard.Row>
        <InlineKeyboard.Row>
          <Button text="📱 Share Contact" onClick={() => navigate('/contact-demo')} />
          <Button text="🗂 Gallery" onClick={() => navigate('/showcase/gallery', { mode: 'push' })} />
        </InlineKeyboard.Row>
        <InlineKeyboard.Row>
          <Button text="❌ Close Buttons" onClick={() => navigate('/showcase', { mode: 'dismiss' })} />
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </InlineKeyboard.Row>
      </InlineKeyboard>
    </Message>
  );
}

export function ComponentGallery() {
  const navigate = useNavigate();

  return (
    <>
      <Message text={'📦 All Components\n\nQuick reference of every available component.'}>
        <Message.Bold>Conversation API</Message.Bold>
        {'\nreplyWithPhoto, replyWithVideo, replyWithAnimation, replyWithAudio,\nreplyWithVoice, replyWithDocument, replyWithContact, replyWithLocation,\nreplyWithVenue, replyWithMediaGroup, replyWithSticker, replyWithVideoNote'}
      </Message>

      <Divider />

      <Alert variant="info" title="React Hooks">
        useChat, useTelegram, usePhoto, useVideo, useAudio, useVoice, useLocation, useContact
      </Alert>

      <List ordered>
        <List.Item>Message, Bold, Italic, Code</List.Item>
        <List.Item>Photo, Video, Animation, Voice, Audio</List.Item>
        <List.Item>VideoNote, Sticker, Document</List.Item>
        <List.Item>Contact, Location, Venue</List.Item>
        <List.Item>MediaGroup (Photo, Video)</List.Item>
        <List.Item>InlineKeyboard, Button, ButtonRow</List.Item>
        <List.Item>ReplyKeyboard + RequestContact/Location</List.Item>
        <List.Item>Notification, Alert, Divider, List</List.Item>
      </List>

      <Divider />

      <Message text="Navigate modes:">
        <InlineKeyboard>
          <InlineKeyboard.Row>
            <Button text="replace (edit)" onClick={() => navigate('/')} />
            <Button text="push (keep)" onClick={() => navigate('/', { mode: 'push' })} />
          </InlineKeyboard.Row>
          <InlineKeyboard.Row>
            <Button text="stack (strip btns)" onClick={() => navigate('/', { mode: 'stack' })} />
            <Button text="dismiss (close)" onClick={() => navigate('/showcase/gallery', { mode: 'dismiss' })} />
          </InlineKeyboard.Row>
        </InlineKeyboard>
      </Message>

      <Divider />

      <Message text="Actions:">
        <InlineKeyboard>
          <InlineKeyboard.Row>
            <Button text="🎬 Start Tour" conversation={showcase} variant="primary" />
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </InlineKeyboard.Row>
        </InlineKeyboard>
      </Message>
    </>
  );
}
