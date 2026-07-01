import { useNavigate, useParams, useBot } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

export function PokemonComments() {
  const { id } = useParams<'/pokemon/:id/comments'>();
  const navigate = useNavigate();
  const bot = useBot();

  return (
    <Message text={
      `💬 Comments — Pokemon #${id}\n\n` +
      `This is a nested route: /pokemon/${id}/comments\n\n` +
      `Share this link to let others jump here directly:\n` +
      `https://t.me/${bot.botUsername}?start=comments-${id}\n\n` +
      `No comments yet. Be the first!`
    }>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="⬅️ Back to Card" onClick={() => navigate(`/pokemon/${id}`)} />
          <Button text="📤 Share" url={`https://t.me/${bot.botUsername}?start=comments-${id}`} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
