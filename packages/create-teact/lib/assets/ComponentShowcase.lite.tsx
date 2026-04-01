import React from 'react';
import { useNavigate, useOn, useBot } from '@teactjs/core';
import {
  Message, InlineKeyboard, Button, Alert, List, Divider,
} from '@teactjs/ui';

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
    <Message text={'🧪 Component Showcase\n\nEnable the **Conversations** feature in `teact.config.ts` to run the guided tour with `defineConversation`.\n\nBelow: URL openers, Mini Apps, and deep links.'}>
      <InlineKeyboard>
        <InlineKeyboard.Row>
          <Button text="🌐 Open URL" url="https://telegram.org" />
          <Button.WebApp text="🚀 Mini App" url="https://webappcontent.telegram.org/cafe" />
        </InlineKeyboard.Row>
        <InlineKeyboard.Row>
          <Button text="📤 Deep Link → Comments" url={`https://t.me/${bot.botUsername}?start=comments-25`} />
        </InlineKeyboard.Row>
        <InlineKeyboard.Row>
          <Button text="🗂 Gallery" onClick={() => navigate('/showcase/gallery', { mode: 'push' })} />
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
        {'\nreplyWithPhoto, replyWithVideo, … (enable Conversations plugin for the full tour)'}
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

      <Message text="Actions:">
        <InlineKeyboard>
          <InlineKeyboard.Row>
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </InlineKeyboard.Row>
        </InlineKeyboard>
      </Message>
    </>
  );
}
