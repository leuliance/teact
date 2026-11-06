import { useState } from 'react';
import { useNavigate } from '@teactjs/core';
import { Message, Button, InlineKeyboard, ButtonRow } from '@teactjs/ui';
import { usePokemonList } from '../hooks/usePokemon';

export function PokemonList() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const { data: list, isLoading, isError, refetch } = usePokemonList(page);

  if (isLoading) return <Message text="Loading pokemon list..." />;
  if (isError || !list) {
    // Always give the user a way out of an error screen.
    return (
      <Message text="⚠️ Failed to load the pokemon list. The Pokedex API may be unreachable.">
        <InlineKeyboard>
          <ButtonRow>
            <Button text="🔄 Retry" onClick={() => { void refetch(); }} />
            <Button text="🏠 Menu" onClick={() => navigate('/')} />
          </ButtonRow>
        </InlineKeyboard>
      </Message>
    );
  }

  const header = `📋 Pokedex (page ${page + 1})`;
  const items = list.map((p) => `#${p.id} ${p.name}`).join('\n');

  return (
    <Message text={`${header}\n\n${items}`}>
      <InlineKeyboard>
        {list.map((p) => (
          <ButtonRow key={p.id}>
            <Button
              text={`#${p.id} ${p.name}`}
              onClick={() => navigate(`/pokemon/${p.id}`, { mode: 'stack' })}
            />
          </ButtonRow>
        ))}
        <ButtonRow>
          <Button text="⬅️ Prev" onClick={() => setPage((p) => Math.max(0, p - 1))} />
          <Button text="➡️ Next" onClick={() => setPage((p) => p + 1)} />
        </ButtonRow>
        <ButtonRow>
          <Button text="🏠 Menu" onClick={() => navigate('/')} />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
