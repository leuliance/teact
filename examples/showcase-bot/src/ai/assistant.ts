/**
 * Simulated AI completion stream.
 *
 * `streamCompletion` yields an answer token-by-token with realistic pacing so the
 * message "types" itself in via `useStream`. It's intentionally dependency-free so
 * the showcase runs with only a Telegram token.
 *
 * 🔌 Plug in a real LLM (e.g. Anthropic Claude) by replacing the body of
 * `streamCompletion` with a streaming API call and yielding each text delta:
 *
 *   import Anthropic from '@anthropic-ai/sdk';
 *   const client = new Anthropic();
 *   export async function* streamCompletion(prompt: string) {
 *     const stream = await client.messages.stream({
 *       model: 'claude-sonnet-4-6',
 *       max_tokens: 1024,
 *       messages: [{ role: 'user', content: prompt }],
 *     });
 *     for await (const event of stream) {
 *       if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
 *         yield event.delta.text;
 *       }
 *     }
 *   }
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number, spread: number) => base + Math.floor(Math.random() * spread);

export interface AIPrompt {
  id: string;
  label: string;
  /** The (canned) answer streamed back. Swap for a real model response. */
  answer: string;
}

export const AI_PROMPTS: AIPrompt[] = [
  {
    id: 'pikachu',
    label: 'Explain Pikachu in one paragraph',
    answer:
      "Pikachu is an Electric-type Pokémon and the franchise's iconic mascot. " +
      'It stores electricity in its cheek pouches and discharges it when threatened ' +
      'or excited. In battle it shines with speed and special attacks like Thunderbolt, ' +
      'though its modest defenses mean it rewards a hit-and-run playstyle. Beyond the ' +
      'games, Pikachu is the emotional center of the anime — proof that a well-designed ' +
      'character can carry an entire universe. ⚡',
  },
  {
    id: 'haiku',
    label: 'Write a haiku about Charizard',
    answer:
      'Wings carve the warm sky —\n' +
      'a quiet roar of embers,\n' +
      'dusk learns how to burn. 🔥',
  },
  {
    id: 'matchups',
    label: 'Give me type-matchup strategy',
    answer:
      'Think in triangles, not lists.\n\n' +
      '• Water beats Fire, Fire beats Grass, Grass beats Water — the classic core.\n' +
      '• Electric punishes Water and Flying, but Ground walls it completely.\n' +
      '• Ghost and Dark counter each other and dodge Normal entirely.\n\n' +
      'The winning habit: predict the switch, not the move. Bring a Pokémon that ' +
      'threatens what your opponent will bring in, and you control the tempo. 🧠',
  },
  {
    id: 'teact',
    label: 'What is Teact?',
    answer:
      'Teact lets you build Telegram bots with React — components, hooks, state and ' +
      'routing, the same mental model as the web. This very message is a React ' +
      'component re-rendering as the answer streams in, edited live through the ' +
      'Telegram API. The adapter is swappable (grammY today), so the same bot could ' +
      'one day run on Discord or WhatsApp. 🤖',
  },
];

/** Stream an answer token-by-token, like a real LLM completion. */
export async function* streamCompletion(answer: string): AsyncGenerator<string> {
  await delay(450); // initial "time to first token"
  const tokens = answer.match(/\S+\s*|\n+/g) ?? [answer];
  for (const tok of tokens) {
    yield tok;
    await delay(tok.includes('\n') ? jitter(120, 120) : jitter(35, 85));
  }
}

const CREATURES = ['Bulbasaur', 'Gengar', 'Snorlax', 'Lucario', 'Dragonite', 'Mimikyu', 'Garchomp'];

/** A randomized "AI analyst" answer so "Surprise me" feels alive each time. */
export function randomAnalysis(): AIPrompt {
  const name = CREATURES[Math.floor(Math.random() * CREATURES.length)];
  return {
    id: `analysis-${name}`,
    label: `Analyze ${name}`,
    answer:
      `Quick read on ${name}:\n\n` +
      `It's a fan-favorite for a reason — a memorable design backed by a kit that ` +
      `rewards smart positioning. Lead with utility, keep it healthy, and let it ` +
      `close games once the board is softened up. Pair it with a partner that covers ` +
      `its weaknesses and ${name} becomes a genuine win condition. 🏆`,
  };
}
