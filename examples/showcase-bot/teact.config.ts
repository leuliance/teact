import { defineConfig, authPlugin } from '@teactjs/core';
import { conversationsPlugin, streamPlugin } from '@teactjs/telegram';
import { storagePlugin } from '@teactjs/storage';
import { analyticsPlugin } from './src/plugins/analytics';

export default defineConfig({
  mode: 'polling',

  plugins: [
    storagePlugin({ driver: 'file', path: '.teact/storage.json' }),
    conversationsPlugin(),
    streamPlugin(),
    authPlugin({ admins: [] }),
    // A custom plugin authored with @teactjs/plugin-sdk (see src/plugins/analytics.ts)
    analyticsPlugin({ verbose: true }),
  ],
});
