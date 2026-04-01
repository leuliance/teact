import { useConversation, Conversation, useNavigate } from '@teactjs/core';
import { Message, InlineKeyboard, ButtonRow, Button, Poll } from '@teactjs/ui';

export function FeedbackWithHook() {
  const navigate = useNavigate();

  const conv = useConversation({
    opinion: {
      prompt: '💬 We\'d love your feedback!\n\nWhat do you think of this bot?',
      validate: (v) => v.length >= 5 || 'Please write at least 5 characters',
    },
    rating: {
      ask: 'Rate your experience:',
      options: [
        [{ text: '⭐', value: '1' }, { text: '⭐⭐', value: '2' }, { text: '⭐⭐⭐', value: '3' }],
        [{ text: '⭐⭐⭐⭐', value: '4' }, { text: '⭐⭐⭐⭐⭐', value: '5' }],
      ],
    },
    poll: {
      render: (done, { back, canGoBack }) => (
        <>
          <Poll
            question="Which features should we improve?"
            options={['Speed', 'UI Design', 'More Pokémon', 'Better Search']}
            allowsMultipleAnswers
            isAnonymous={false}
          />
          <Message text="Answer the poll above, then tap Continue ⬇️">
            <InlineKeyboard>
              <ButtonRow>
                {canGoBack() && <Button text="⬅️ Back" onClick={() => back()} />}
                <Button text="Continue ➡️" onClick={() => done('answered')} />
              </ButtonRow>
            </InlineKeyboard>
          </Message>
        </>
      ),
    },
  });

  return (
    <Conversation value={conv}>
      <Conversation.Complete>
        <Message text={
          `✅ Thanks for your feedback!\n\n` +
          `📝 "${conv.data.opinion}"\n` +
          `⭐ Rating: ${conv.data.rating}/5\n\n` +
          `Use /start to go back to the menu.`
        }>
          <InlineKeyboard>
            <ButtonRow>
              <Button text="✏️ Change Opinion" onClick={() => conv.goTo('opinion')} />
              <Button text="⭐ Change Rating" onClick={() => conv.goTo('rating')} />
            </ButtonRow>
            <ButtonRow>
              {conv.canGoBack() && <Button text="⬅️ Go Back" onClick={() => conv.back()} />}
              <Button text="🔄 Start Over" onClick={() => conv.reset()} />
              <Button text="🏠 Menu" onClick={() => navigate('/')} />
            </ButtonRow>
          </InlineKeyboard>
        </Message>
      </Conversation.Complete>
    </Conversation>
  );
}
