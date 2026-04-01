import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBot, createRouter, createI18n, redirect } from '@teact/core';
import type { Middleware } from '@teact/core';
import { TelegramAdapter } from '@teact/telegram';
import { commands } from './commands';

// Pages
import { MainMenu } from './pages/MainMenu';
import { PokemonList } from './pages/PokemonList';
import { PokemonCard } from './pages/PokemonCard';
import { PokemonComments } from './pages/PokemonComments';
import { Counter } from './pages/Counter';
import { TrainerProfile } from './pages/TrainerProfile';
import { Settings } from './pages/Settings';
import { FeedbackLauncher } from './pages/FeedbackLauncher';
import { StreamDemo } from './pages/StreamDemo';
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

const router = createRouter(
  {
    '/': MainMenu,
    '/list': PokemonList,
    '/pokemon/:id': PokemonCard,
    '/pokemon/:id/comments': PokemonComments,
    '/counter': Counter,
    '/profile': TrainerProfile,
    '/settings': Settings,
    '/feedback': FeedbackLauncher,
    '/stream': StreamDemo,
    '/admin': AdminPanel,
    '/showcase': ComponentShowcase,
    '/showcase/gallery': ComponentGallery,
    '/feedback-hook': FeedbackWithHook,
    '/contact-demo': ContactDemo,
    '/store': StorePage,
    '/language': LanguagePage,
    '/secret': {
      component: SecretPage,
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
    '/session-demo': SessionDemo,
  },
  { notFound: NotFoundPage },
);

const bot = createBot({
  adapter: new TelegramAdapter(),
  router,
  providers: ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <i18n.Provider>{children}</i18n.Provider>
    </QueryClientProvider>
  ),
  middleware: [loggerMiddleware],
  experimental: {},
  commands,
});

bot.start();
