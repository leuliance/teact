import { useNavigate, useStream } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* generateBattleStrategy() {
  yield '🤖 Generating your personalized battle strategy';
  await delay(600);
  yield '...\n\n';
  await delay(400);
  yield '⚔️ **Offensive Moves**\n';
  await delay(500);
  yield '• Use Thunderbolt against Water types\n';
  await delay(400);
  yield '• Fire Blast melts Steel and Ice\n';
  await delay(400);
  yield '• Earthquake covers Electric matchups\n\n';
  await delay(600);
  yield '🛡️ **Defensive Tips**\n';
  await delay(500);
  yield '• Switch to Ground type vs Electric\n';
  await delay(400);
  yield '• Water resists Fire, Ice, and Steel\n';
  await delay(400);
  yield '• Flying dodges Ground and Fighting\n\n';
  await delay(600);
  yield '✅ Strategy complete! Good luck, trainer!';
}

export function StreamDemo() {
  const navigate = useNavigate();
  const { text, isStreaming, stream } = useStream({ throttleMs: 400 });

  return (
    <Message text={text || '⚡ Stream Demo\n\nWatch text generate in real-time, like an AI response!'}>
      <InlineKeyboard>
        <ButtonRow>
          <Button
            text={isStreaming ? '⏳ Streaming…' : '▶️ Generate Strategy'}
            onClick={() => { if (!isStreaming) stream(generateBattleStrategy()); }}
          />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
