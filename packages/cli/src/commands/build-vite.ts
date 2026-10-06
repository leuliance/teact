import { build } from 'vite';
import { createBuildConfig } from '../vite-config';

/** Production build through Vite (SSR bundle → dist/index.js). Used with `--vite` or a vite.config.*. */
export async function buildWithVite(opts: { root: string; entry: string; minify?: boolean; sourcemap?: boolean }): Promise<void> {
  await build(createBuildConfig(opts));
}
