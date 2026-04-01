# @teact/runtime

The bot engine powering Teact. Provides `createBot`, routing, sessions, hooks, middleware, conversations, forms, streaming, authentication, events, i18n, and payments.

## Install

```bash
bun add @teact/runtime
```

## createBot

```ts
import { createBot } from "@teact/runtime";
import { TelegramAdapter } from "@teact/telegram";

const bot = createBot({
  component: App,            // root component (or use `router`)
  adapter: new TelegramAdapter(),
  token: process.env.BOT_TOKEN,
  mode: "polling",           // "polling" | "webhook"
  session: { ttl: 3600_000 },
  plugins: [storagePlugin()],
  commands: {
    start: { description: "Start the bot", route: "/" },
    help: { description: "Show help", handler: (ctx) => ctx.reply("Help text") },
  },
});

await bot.start();
```

**Options:** `component` or `router` (mutually exclusive), `adapter`, `token`, `mode`, `webhook` (`{ domain, port?, path?, secretToken? }`), `session` (`{ store?, ttl? }`), `middleware`, `plugins`, `commands`, `providers`, `experimental`.

## Routing

```ts
import { createRouter } from "@teact/runtime";

const router = createRouter(
  {
    "/": Home,
    "/settings": { component: Settings, beforeLoad: guardAuth },
    "/pokemon/:id": PokemonDetail,
  },
  { notFound: NotFoundPage }, // optional custom 404
);

const bot = createBot({ router, adapter, token });
```

### Route Guards

Guards run before a route loads. They can redirect, reply with a message, or render JSX:

```ts
// Redirect
beforeLoad: ({ session }) => {
  if (!session.auth) return redirect("/login");
}

// Reply with a message and buttons (same API as command handlers)
beforeLoad: ({ session, reply }) => {
  if (!session.auth) return reply("Please log in.", {
    buttons: [[{ text: "Login", route: "/login" }, { text: "Home", route: "/" }]],
  });
}

// Return JSX directly
beforeLoad: ({ session }) => {
  if (!session.auth) return <LoginPage />;
}
```

### Navigation Hooks

```tsx
function Home() {
  const navigate = useNavigate();
  const { path, params } = useRoute();

  return (
    <Message text="Home">
      <InlineKeyboard>
        <Button text="Settings" onClick={() => navigate("/settings")} />
        <Button text="Back" onClick={() => navigate("/", { mode: "dismiss" })} />
      </InlineKeyboard>
    </Message>
  );
}
```

- `useNavigate()` -- returns `(path, opts?) => void`. Modes: `push`, `replace`, `stack`, `dismiss`.
- `useParams<T>()` -- typed route params.
- `useRoute()` -- current `{ path, params }`.

## Context Hooks

| Hook | Returns |
|------|---------|
| `useBot()` | Bot instance and metadata |
| `useSession()` | `[sessionData, patchFn]` -- read and update session |
| `usePlatform()` | Current platform string |
| `useChatId()` | Current chat ID |
| `useText()` | Last message text |
| `useCallbackData()` | Last callback query data |
| `useCommand()` | Parsed command and args |

## Conversations

Multi-step user flows with validation.

```tsx
const { step, value, actions } = useConversation({
  name: { prompt: "What's your name?", validate: (v) => v.length > 0 || "Name required" },
  age: { prompt: "How old are you?", validate: (v) => Number(v) > 0 || "Must be a number" },
});
```

Declarative alternative:

```tsx
<Conversation>
  <Conversation.Prompt text="What's your name?" step="name" />
  <Conversation.Prompt text="How old are you?" step="age" />
  <Conversation.Complete>
    {(data) => <Message text={`Hi ${data.name}, age ${data.age}`} />}
  </Conversation.Complete>
</Conversation>
```

## Forms

Schema-driven forms with `useForm`:

```tsx
const form = useForm({
  name: { type: "string", required: true },
  email: { type: "string", validate: validateEmail },
});
```

## Events

```tsx
useOn("message:text", (ctx) => {
  console.log("Text received:", ctx.raw);
});

const photo = useEventData("message:photo");
```

Supported events include `message`, `message:text`, `message:photo`, `callback_query`, `pre_checkout_query`, `successful_payment`, and `*` for all events.

## Media Hooks

Send media programmatically:

```ts
const sendPhoto = usePhoto();
const sendVideo = useVideo();
const sendDocument = useDocument();
const sendVoice = useVoice();
const sendAudio = useAudio();
const sendSticker = useSticker();
const sendLocation = useLocation();
const sendContact = useContact();
const sendPoll = usePoll();
```

Each returns an async function that calls the Telegram API directly.

## Streaming

Real-time text updates:

```tsx
const { text, isStreaming, stream } = useStream({ throttleMs: 100 });

async function handleStream() {
  await stream(generateTokens());
}

return <Message text={isStreaming ? text : "Done: " + text} />;
```

## Authentication

```ts
import { authPlugin, useAuth } from "@teact/runtime";

// Register the plugin
const bot = createBot({
  plugins: [authPlugin({ admins: [123456789] })],
  // ...
});

// In a component
function Admin() {
  const { isAdmin, role, is, hasAny } = useAuth();
  if (!isAdmin) return <Message text="Unauthorized" />;
  return <Message text="Admin panel" />;
}
```

## Auth Sessions

Token-based auth backed by the session store:

```tsx
import { useAuthSession } from "@teact/runtime";

function LoginPage() {
  const auth = useAuthSession();

  if (auth.isAuthenticated) {
    return <Message text={`Welcome back! Token: ${auth.accessToken}`} />;
  }

  return (
    <Message text="Please log in">
      <InlineKeyboard>
        <ButtonRow>
          <Button
            text="Login"
            onClick={() => auth.login({ accessToken: "tok_abc", refreshToken: "ref_xyz" })}
          />
        </ButtonRow>
      </InlineKeyboard>
    </Message>
  );
}
```

- `auth.isAuthenticated` — `true` when a non-expired access token exists.
- `auth.login(tokens)` — store access/refresh tokens + optional `expiresAt`.
- `auth.logout()` — clear all auth data.
- `auth.setAccessToken(token, expiresAt?)` — update the token (e.g. after refresh).

## i18n

```ts
import { createI18n, useLocale } from "@teact/runtime";

const i18n = createI18n({
  defaultLocale: "en",
  resources: {
    en: { greeting: "Hello {{name}}!" },
    es: { greeting: "Hola {{name}}!" },
  },
});

function Greeting() {
  const { t, locale, setLocale } = useLocale();
  return <Message text={t("greeting", { name: "World" })} />;
}
```

## Payments

```tsx
const { send, status, receipt, error } = useInvoice({
  title: "Premium Plan",
  description: "Monthly subscription",
  currency: "USD",
  prices: [{ label: "Premium", amount: 999 }],
  providerToken: process.env.PAYMENT_TOKEN,
});
```

## Middleware

Middleware runs on every update before rendering. `next()` is called automatically if your middleware doesn't call it, so simple middleware like loggers just work:

```ts
const logger: Middleware = async (ctx) => {
  console.log(`Update from ${ctx.chatId}: ${ctx.text}`);
};

const bot = createBot({
  middleware: [logger],
  // ...
});
```

You can still call `next()` explicitly if you need to run code after the rest of the chain:

```ts
const timer: Middleware = async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`Took ${Date.now() - start}ms`);
};
```

## Debugging

Enable verbose logging to diagnose stuck bots or network issues:

```ts
const bot = createBot({
  adapter: new TelegramAdapter(),
  debug: true,  // logs every update, render cycle, middleware execution
  // ...
});
```

## Plugins

Implement the `TeactPlugin` interface:

```ts
const myPlugin: TeactPlugin = {
  name: "my-plugin",
  onStart: (bot) => { /* setup */ },
  middleware: (ctx, next) => { /* per-update */ return next(); },
  Provider: ({ children }) => <MyContext.Provider>{children}</MyContext.Provider>,
  onStop: () => { /* cleanup */ },
};
```

## Configuration

```ts
import { defineConfig } from "@teact/runtime";

export default defineConfig({
  plugins: [storagePlugin(), authPlugin()],
});
```

## See Also

- [`@teact/core`](../core) for the barrel import
- [`@teact/react`](../react) for UI components
- [`@teact/telegram`](../telegram) for the Telegram adapter
