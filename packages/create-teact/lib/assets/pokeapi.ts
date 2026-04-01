export interface Pokemon {
  id: number;
  name: string;
  types: string[];
  stats: { name: string; value: number }[];
  height: number;
  weight: number;
  sprite: string;
}

export async function fetchPokemon(nameOrId: string | number): Promise<Pokemon> {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${String(nameOrId).toLowerCase()}`);
  if (!res.ok) throw new Error(`Pokemon "${nameOrId}" not found`);
  const data = await res.json();

  return {
    id: data.id,
    name: data.name,
    types: data.types.map((t: { type: { name: string } }) => t.type.name),
    stats: data.stats.map((s: { stat: { name: string }; base_stat: number }) => ({
      name: s.stat.name,
      value: s.base_stat,
    })),
    height: data.height,
    weight: data.weight,
    sprite: data.sprites.front_default,
  };
}

export interface PokemonListItem {
  name: string;
  id: number;
}

export async function fetchPokemonList(offset = 0, limit = 5): Promise<PokemonListItem[]> {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon?offset=${offset}&limit=${limit}`);
  const data = await res.json();
  return data.results.map((p: { name: string }, i: number) => ({
    name: p.name,
    id: offset + i + 1,
  }));
}
