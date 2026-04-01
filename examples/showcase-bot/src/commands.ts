import type { CommandDef } from '@teact/core';

export const commands: Record<string, CommandDef> = {
  start: {
    description: 'Start the showcase bot',
    route: '/',
    deepLink: (args) => {
      const param = args[0];
      if (param?.startsWith('comments-')) return `/pokemon/${param.slice(9)}/comments`;
      if (param?.startsWith('poke-')) return `/pokemon/${param.slice(5)}`;
      return '/';
    },
  },
  pokedex: { description: 'Open Pokedex', route: '/list' },
  profile: { description: 'Create trainer profile', route: '/profile' },
  settings: { description: 'Bot settings', route: '/settings' },
  feedback: { description: 'Send feedback' },
  stream: { description: 'Stream demo', route: '/stream' },
  showcase: { description: 'Component showcase', route: '/showcase' },
  feedbackhook: { description: 'Feedback (hook version)', route: '/feedback-hook' },
  store: { description: 'Premium store', route: '/store' },
  language: { description: 'Change language', route: '/language' },
  secret: { description: 'Secret area (requires login)', route: '/secret' },
  help: {
    description: 'Show help',
    handler: ({ reply }) =>
      reply('What do you need help with?', {
        buttons: [
          [{ text: 'How to use', route: '/list' }, { text: 'My profile', route: '/profile' }],
          [{ text: 'Contact support', url: 'https://t.me/teact_support' }],
        ],
      }),
  },
};
