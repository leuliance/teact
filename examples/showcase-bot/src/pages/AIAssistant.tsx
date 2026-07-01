import { useState } from 'react';
import { useNavigate, useStream, useOptionalService } from '@teactjs/core';
import { Message, Button, InlineKeyboard } from '@teactjs/ui';
import { AI_PROMPTS, streamCompletion, randomAnalysis, type AIPrompt } from '../ai/assistant';
import type { Analytics } from '../plugins/analytics';

/**
 * AI Assistant — streams completions token-by-token via `useStream`, editing the
 * same Telegram message live (like ChatGPT / Claude typing a reply).
 *
 * Swap `streamCompletion` in ../ai/assistant.ts for a real LLM to make it live.
 */
export function AIAssistant() {
  const navigate = useNavigate();
  const { text, isStreaming, stream } = useStream({ throttleMs: 250 });
  const [asked, setAsked] = useState<AIPrompt | null>(null);
  // DI: read the service provided by our custom plugin (src/plugins/analytics.ts)
  const analytics = useOptionalService<Analytics>('analytics');

  const ask = (p: AIPrompt) => {
    if (isStreaming) return;
    setAsked(p);
    stream(streamCompletion(p.answer));
  };

  const intro =
    '🤖 Teact AI Assistant\n\n' +
    'Pick a prompt — the answer streams in token-by-token, exactly like a real LLM ' +
    'completion. (It edits this one message live via the Telegram API.)';

  const cursor = isStreaming ? ' ▌' : '';
  const footer = analytics ? `\n\n— updates handled by the analytics plugin: ${analytics.hits}` : '';
  const body = asked
    ? `🧑 You: ${asked.label}\n\n🤖 AI:\n${text}${cursor}${isStreaming ? '' : footer}`
    : intro + footer;

  return (
    <Message text={body}>
      <InlineKeyboard columns={1}>
        {AI_PROMPTS.map((p) => (
          <Button key={p.id} text={`💬 ${p.label}`} onClick={() => ask(p)} />
        ))}
        <Button text="🎲 Surprise me" onClick={() => ask(randomAnalysis())} />
        {asked && !isStreaming && (
          <Button text="🔁 Regenerate" onClick={() => ask(asked)} />
        )}
        <Button text="🏠 Menu" route="/" />
      </InlineKeyboard>
    </Message>
  );
}
