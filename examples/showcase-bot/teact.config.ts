import { defineConfig } from '@teactjs/core';

// Plugins are registered in src/index.tsx via createBot({ plugins }) so they load both
// in local dev AND when deployed to the edge (Cloudflare Workers), where this config
// file isn't read (there's no filesystem to load it from). Keep only runtime-mode config
// here — anything a serverless deploy needs must go through createBot(...).
export default defineConfig({
  mode: 'polling',
});
