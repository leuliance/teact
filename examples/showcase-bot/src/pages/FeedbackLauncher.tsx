import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';
import { defineConversation } from '@teactjs/telegram';

const feedback = defineConversation('feedback', {
  command: 'feedback',
  async handler(conversation) {
    const opinion = await conversation.prompt(
      '💬 We\'d love your feedback!\n\nWhat do you think of this bot?',
      { validate: (v) => v.length >= 5 || 'Please write at least 5 characters' },
    );

    const rating = await conversation.ask('Rate your experience:', [
      [{ text: '⭐', value: '1' }, { text: '⭐⭐', value: '2' }, { text: '⭐⭐⭐', value: '3' }],
      [{ text: '⭐⭐⭐⭐', value: '4' }, { text: '⭐⭐⭐⭐⭐', value: '5' }],
    ]);

    const contact = await conversation.requestContact(
      '📱 Would you like to share your contact info? Tap the button below.',
    );

    await conversation.replyWithPoll(
      'Which features should we improve?',
      ['Speed', 'UI Design', 'More Pokémon', 'Better Search'],
      { allows_multiple_answers: true, is_anonymous: false },
    );

    await conversation.send(
      `✅ Thanks for your feedback!\n\n` +
      `📝 "${opinion}"\n⭐ Rating: ${rating}/5\n` +
      `📱 Contact: ${contact.phone_number} (${contact.first_name})\n\n` +
      `Use /start to go back to the menu.`,
    );
  },
});

export function FeedbackLauncher() {
  const navigate = useNavigate();

  return (
    <Message text={'💬 Feedback\n\nClick below to start a multi-step conversation.'}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="📝 Give Feedback" conversation={feedback} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
