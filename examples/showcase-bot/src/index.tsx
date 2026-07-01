import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBot, createRouter, createI18n, redirect, authPlugin } from '@teactjs/core';
import type { Middleware, CommandDef } from '@teactjs/core';
import { TelegramAdapter, conversationsPlugin, streamPlugin } from '@teactjs/telegram';
import { storagePlugin } from '@teactjs/storage';
import { analyticsPlugin } from './plugins/analytics';

// Pages
import { MainMenu } from './pages/MainMenu';
import { PokemonList } from './pages/PokemonList';
import { PokemonCard } from './pages/PokemonCard';
import { PokemonComments } from './pages/PokemonComments';
import { Counter } from './pages/Counter';
import { TrainerProfile } from './pages/TrainerProfile';
import { Settings } from './pages/Settings';
import { FeedbackLauncher } from './pages/FeedbackLauncher';
import { AIAssistant } from './pages/AIAssistant';
import { AdminPanel } from './pages/AdminPanel';
import { ComponentShowcase, ComponentGallery } from './pages/ComponentShowcase';
import { FeedbackWithHook } from './pages/FeedbackWithHook';
import { SecretPage } from './pages/SecretPage';
import { SecretLoginPage } from './pages/SecretLoginPage';
import { LoginPage } from './pages/LoginPage';
import { SessionDemo } from './pages/SessionDemo';
import { ContactDemo } from './pages/ContactDemo';
import { StorePage } from './pages/StorePage';
import { LanguagePage } from './pages/LanguagePage';
import { NotFoundPage } from './pages/NotFoundPage';

// i18n
import en from './locales/en.json';
import am from './locales/am.json';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

const i18n = createI18n({
  defaultLocale: 'en',
  resources: {
    en: { translation: en },
    am: { translation: am },
  },
});

const loggerMiddleware: Middleware = async (ctx) => {
  console.log(`[middleware] ${ctx.chatId} | ${ctx.text ?? ctx.callbackData ?? '—'}`);
};

// Commands are CO-LOCATED on their routes via `command:` — one source of truth.
// createBot collects them automatically (see Phase 3 of the revamp).
const router = createRouter(
  {
    '/': {
      component: MainMenu,
      command: {
        name: 'start',
        description: 'Open the showcase',
        // Deep links: t.me/yourbot?start=poke-25  →  /pokemon/25
        deepLink: (args) => {
          const param = args[0];
          if (param?.startsWith('comments-')) return `/pokemon/${param.slice(9)}/comments`;
          if (param?.startsWith('poke-')) return `/pokemon/${param.slice(5)}`;
          return '/';
        },
      },
    },
    '/ai': { component: AIAssistant, command: { name: 'ai', description: '🤖 AI assistant (streaming)' } },
    '/stream': AIAssistant, // alias
    '/list': { component: PokemonList, command: { name: 'pokedex', description: 'Browse the Pokédex' } },
    '/pokemon/:id': PokemonCard,
    '/pokemon/:id/comments': PokemonComments,
    '/counter': { component: Counter, command: { name: 'counter', description: 'Counter (useState)' } },
    '/profile': { component: TrainerProfile, command: { name: 'profile', description: 'Trainer profile (form)' } },
    '/settings': { component: Settings, command: { name: 'settings', description: 'Settings (storage)' } },
    '/feedback': { component: FeedbackLauncher, command: { name: 'feedback', description: 'Send feedback (conversation)' } },
    '/feedback-hook': FeedbackWithHook,
    '/admin': { component: AdminPanel, command: { name: 'admin', description: 'Admin panel (roles)' } },
    '/showcase': { component: ComponentShowcase, command: { name: 'showcase', description: 'Component gallery' } },
    '/showcase/gallery': ComponentGallery,
    '/contact-demo': { component: ContactDemo, command: { name: 'contact', description: 'Contact & events demo' } },
    '/store': { component: StorePage, command: { name: 'store', description: 'Premium store (payments)' } },
    '/language': { component: LanguagePage, command: { name: 'language', description: 'Change language (i18n)' } },
    '/session-demo': { component: SessionDemo, command: { name: 'session', description: 'Session state demo' } },
    '/secret': {
      component: SecretPage,
      command: { name: 'secret', description: 'Secret area (requires login)' },
      beforeLoad: ({ session }) => {
        if (!session.auth?.accessToken) return redirect('/');
      },
    },
    '/secret-login': {
      component: SecretLoginPage,
      beforeLoad: ({ session }) => {
        if (!session.auth?.accessToken) return <LoginPage />;
      },
    },
    '/secret-reply': {
      component: SecretLoginPage,
      beforeLoad: ({ session, reply }) => {
        if (!session.auth?.accessToken) return reply('🔒 You need to log in first.', {
          buttons: [
            [{ text: '🔑 Login', route: '/login' }, { text: '🏠 Menu', route: '/' }],
          ],
        });
      },
    },
    '/login': LoginPage,
  },
  { notFound: NotFoundPage },
);

// Handler-only commands (no route) stay here. Everything else is co-located above.
const commands: Record<string, CommandDef> = {
  help: {
    description: 'Show help',
    handler: ({ reply }) =>
      reply('What do you need help with?', {
        buttons: [
          [{ text: '🤖 AI Assistant', route: '/ai' }, { text: '📋 Pokédex', route: '/list' }],
          [{ text: '🏠 Menu', route: '/' }],
        ],
      }),
  },
};

export const bot = createBot({
  adapter: new TelegramAdapter(),
  router,
  providers: ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <i18n.Provider>{children}</i18n.Provider>
    </QueryClientProvider>
  ),
  middleware: [loggerMiddleware],
  // Plugins are registered here (not only in teact.config.ts) so they also load when
  // deployed to the edge, where teact.config.ts isn't available (no filesystem).
  plugins: [
    storagePlugin({ driver: 'file', path: '.teact/storage.json' }),
    conversationsPlugin(),
    streamPlugin(),
    authPlugin({ admins: [] }),
    analyticsPlugin({ verbose: true }),
  ],
  commands,
});

// Start polling only when run directly (bun dev). A serverless entry (src/worker.ts,
// created by `teact deploy`) imports { bot } and calls bot.fetch(request) instead.
if (import.meta.main) bot.start();
