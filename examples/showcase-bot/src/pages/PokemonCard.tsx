import { useNavigate, useParams, useBot } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow, Alert, Divider, List, ListItem } from '@teactjs/ui';
import { usePokemon } from '../hooks/usePokemon';

export function PokemonCard() {
  const { id } = useParams<'/pokemon/:id'>();
  const navigate = useNavigate();
  const bot = useBot();
  const { data: pokemon, isLoading, isError, error } = usePokemon(Number(id));

  if (isLoading) return <Message text="⏳ Loading pokemon..." />;

  if (isError || !pokemon) {
    return (
      <>
        <Alert variant="error" title="Pokemon not found">
          {error?.message ?? 'Unknown error'}
        </Alert>
        <Message text="">
          <InlineKeyboard>
            <ButtonRow>
              <Button text="🏠 Menu" onClick={() => navigate('/')} />
            </ButtonRow>
          </InlineKeyboard>
        </Message>
      </>
    );
  }

  const typeEmoji: Record<string, string> = {
    fire: '🔥', water: '💧', grass: '🌿', electric: '⚡', psychic: '🔮',
    ice: '❄️', dragon: '🐲', dark: '🌑', fairy: '✨', normal: '⚪',
    fighting: '🥊', flying: '🕊', poison: '☠️', ground: '🌍', rock: '🪨',
    bug: '🐛', ghost: '👻', steel: '⚙️',
  };

  const types = pokemon.types.map((t: string) => `${typeEmoji[t] ?? '❓'} ${t}`).join(', ');
  const hp = pokemon.stats.find((s: any) => s.name === 'hp')?.value ?? '?';
  const atk = pokemon.stats.find((s: any) => s.name === 'attack')?.value ?? '?';
  const def = pokemon.stats.find((s: any) => s.name === 'defense')?.value ?? '?';
  const spd = pokemon.stats.find((s: any) => s.name === 'speed')?.value ?? '?';

  const text = [
    `#${pokemon.id} ${pokemon.name.toUpperCase()}`,
    '',
    `Type: ${types}`,
    `Height: ${pokemon.height / 10}m  Weight: ${pokemon.weight / 10}kg`,
    '',
    `HP: ${hp}  ATK: ${atk}  DEF: ${def}  SPD: ${spd}`,
  ].join('\n');

  return (
    <Message text={text}>
      <InlineKeyboard>
        <ButtonRow>
          <Button text="⬅️ Back" onClick={() => navigate('/list')} />
          <Button
            text="🎲 Random"
            onClick={() => navigate(`/pokemon/${Math.floor(Math.random() * 151) + 1}`)}
          />
        </ButtonRow>
        <ButtonRow>
          <Button text="💬 Comments" onClick={() => navigate(`/pokemon/${pokemon.id}/comments`, { mode: 'stack' })} />
          <Button text="📤 Share" url={`https://t.me/${bot.botUsername}?start=comments-${pokemon.id}`} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
