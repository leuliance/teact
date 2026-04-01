import { useQuery } from '@tanstack/react-query';
import { fetchPokemon, fetchPokemonList } from '../api/pokeapi';

export function usePokemon(nameOrId: string | number) {
  return useQuery({
    queryKey: ['pokemon', nameOrId],
    queryFn: () => fetchPokemon(nameOrId),
  });
}

export function usePokemonList(page: number) {
  return useQuery({
    queryKey: ['pokemon-list', page],
    queryFn: () => fetchPokemonList(page * 5, 5),
  });
}
