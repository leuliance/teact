import { useState } from 'react';
import { useNavigate, useOn, useEventData } from '@teact/core';
import {
  Message, InlineKeyboard, ButtonRow, Button,
  ReplyKeyboard, ReplyRow, RequestContactButton,
  ReplyKeyboardRemove,
} from '@teact/ui';

export function ContactDemo() {
  const navigate = useNavigate();
  const [contact, setContact] = useState<{ phone_number: string; first_name: string } | null>(null);

  useOn('contact', (data) => {
    setContact(data);
  });

  const incomingContact = useEventData<{ phone_number: string; first_name: string }>('contact');
  const displayContact = contact ?? incomingContact;

  if (displayContact) {
    return (
      <Message text={
        `✅ Contact received!\n\n` +
        `📱 Phone: ${displayContact.phone_number}\n` +
        `👤 Name: ${displayContact.first_name}\n\n` +
        `This was shared via Telegram's native contact sharing.`
      }>
        <ReplyKeyboardRemove />
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🔄 Share Again" onClick={() => setContact(null)} />
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  return (
    <Message text="📱 Share Your Contact\n\nTap the button below — Telegram will ask you to confirm sharing your phone number.">
      <ReplyKeyboard resizeKeyboard oneTimeKeyboard>
        <ReplyRow>
          <RequestContactButton text="📱 Share My Contact" />
        </ReplyRow>
      </ReplyKeyboard>
    </Message>
  );
}
