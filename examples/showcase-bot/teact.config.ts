import { defineConfig, authPlugin } from '@teact/core';
import { conversationsPlugin, streamPlugin } from '@teact/telegram';
import { storagePlugin } from '@teact/storage';

export default defineConfig({
  mode: 'polling',

  plugins: [
    storagePlugin({ driver: 'file', path: '.teact/storage.json' }),
    conversationsPlugin(),
    streamPlugin(),
    authPlugin({ admins: [] }),
  ],
});
