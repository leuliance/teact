import { defineConfig, authPlugin } from '@teactjs/core';
import { conversationsPlugin, streamPlugin } from '@teactjs/telegram';
import { storagePlugin } from '@teactjs/storage';

export default defineConfig({
  mode: 'polling',

  plugins: [
    storagePlugin({ driver: 'file', path: '.teact/storage.json' }),
    conversationsPlugin(),
    streamPlugin(),
    authPlugin({ admins: [] }),
  ],
});
