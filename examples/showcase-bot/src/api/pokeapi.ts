export interface Pokemon {
  id: number;
  name: string;
  types: string[];
  stats: { name: string; value: number }[];
  height: number;
  weight: number;
  sprite: string;
}

/** Never wait forever on the API: cancel after 10s (or when the caller aborts). */
const REQUEST_TIMEOUT_MS = 10_000;
function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function fetchPokemon(nameOrId: string | number, signal?: AbortSignal): Promise<Pokemon> {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${String(nameOrId).toLowerCase()}`, { signal: withTimeout(signal) });
  if (!res.ok) throw new Error(`Pokemon "${nameOrId}" not found`);
  const data = await res.json() as any;

  return {
    id: data.id,
    name: data.name,
    types: data.types.map((t: any) => t.type.name),
    stats: data.stats.map((s: any) => ({ name: s.stat.name, value: s.base_stat })),
    height: data.height,
    weight: data.weight,
    sprite: data.sprites.front_default,
  };
}

export async function fetchRandomPokemon(): Promise<Pokemon> {
  const id = Math.floor(Math.random() * 151) + 1;
  return fetchPokemon(id);
}

export interface PokemonListItem {
  name: string;
  id: number;
}

export async function fetchPokemonList(offset = 0, limit = 5, signal?: AbortSignal): Promise<PokemonListItem[]> {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon?offset=${offset}&limit=${limit}`, { signal: withTimeout(signal) });
  const data = await res.json() as any;
  return data.results.map((p: any, i: number) => ({
    name: p.name,
    id: offset + i + 1,
  }));
}
