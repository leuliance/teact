# @teactjs/core

Main entry point for the Teact framework. This package is a barrel that re-exports everything you need from `@teactjs/react`, `@teactjs/runtime`, and `@teactjs/renderer`.

## Install

```bash
bun add @teactjs/core
```

## What It Exports

**React primitives** -- `useState`, `useEffect`, `useReducer`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useId`, `use`, `createContext`, `memo`, `Fragment`, `createElement`, `Suspense`

**Components** -- everything from `@teactjs/react`: `Message`, `Button`, `InlineKeyboard`, `Photo`, `Video`, `Audio`, `Document`, `Poll`, `Location`, `Contact`, `Sticker`, `ReplyKeyboard`, `MediaGroup`, formatting components, and more

**Runtime** -- `createBot`, `createRouter`, `useNavigate`, `useParams`, `useRoute`, `useSession`, `useBot`, `usePlatform`, `useChatId`, `useText`, `useCallbackData`, `useCommand`, `useOn`, `useConversation`, `useForm`, `useStream`, `useAuth`, `useInvoice`, `useLocale`, `createI18n`, `defineConfig`, media hooks, and all associated types

**Renderer** -- `TNode`, `TextNode`, `createRoot`, and types `TeactRoot`, `OutputNode`, `User`, `BotContext`, `SessionData`, `SessionStore`, `Middleware`

## Usage

```tsx
import {
  createBot,
  createRouter,
  Message,
  Button,
  InlineKeyboard,
  useState,
  useNavigate,
} from "@teactjs/core";
```

A single import covers the entire framework API. For finer-grained imports, use the individual packages directly.

## See Also

- [Root README](../../README.md) for getting started
- [`@teactjs/react`](../react) for the full component catalog
- [`@teactjs/runtime`](../runtime) for hooks and bot engine docs
