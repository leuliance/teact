import { useQuery } from '@tanstack/react-query';
import { fetchPokemon, fetchPokemonList } from '../api/pokeapi';

export function usePokemon(nameOrId: string | number) {
  return useQuery({
    queryKey: ['pokemon', nameOrId],
    // TanStack Query passes an AbortSignal: superseded/unmounted requests get cancelled.
    queryFn: ({ signal }) => fetchPokemon(nameOrId, signal),
  });
}

export function usePokemonList(page: number) {
  return useQuery({
    queryKey: ['pokemon-list', page],
    queryFn: ({ signal }) => fetchPokemonList(page * 5, 5, signal),
  });
}
