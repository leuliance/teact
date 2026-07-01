import { useEventData } from '@teactjs/core';
import {
  Message, InlineKeyboard, Button,
  ReplyKeyboard, ReplyRow, RequestContactButton,
  ReplyKeyboardRemove,
} from '@teactjs/ui';

/**
 * Telegram events demo — reads the shared contact declaratively with `useEventData`.
 * (One mechanism only: mixing useEventData with a useOn that also re-renders would
 * emit the "received" message twice.)
 */
export function ContactDemo() {
  const contact = useEventData<{ phone_number: string; first_name: string }>('contact');

  if (contact) {
    return (
      <Message
        text={
          `✅ Contact received!\n\n` +
          `📱 Phone: ${contact.phone_number}\n` +
          `👤 Name: ${contact.first_name}\n\n` +
          `Read with useEventData('contact') — Telegram's native contact sharing.`
        }
      >
        <ReplyKeyboardRemove />
        <InlineKeyboard columns={2}>
          <Button text="🔄 Share Again" route="/contact-demo" />
          <Button text="🏠 Menu" route="/" />
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
