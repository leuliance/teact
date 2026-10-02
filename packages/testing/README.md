# @teactjs/testing

Test your Teact bots without Telegram, a token, or a network.

```bash
bun add -d @teactjs/testing
```

## `createTestBot` — test like a user

Drive the bot the way a person would: send messages, tap buttons by their label, and read
what's on screen. Works with `bun test`, Vitest, or Jest.

```tsx
import { test, expect } from "bun:test";
import { createTestBot } from "@teactjs/testing";
import { Counter } from "./Counter";

test("counter", async () => {
  const t = await createTestBot({ component: Counter, commands: { start: { description: "Start" } } });

  await t.send("/start");
  expect(t.lastMessage?.text).toBe("Count: 0");

  await t.click("+1");                     // tap by label (or a RegExp)
  expect(t.lastMessage?.text).toBe("Count: 1");
  expect(t.lastMessage?.edited).toBe(true); // edited in place, not re-sent
  expect(t.messages).toHaveLength(1);

  await t.stop();
});
```

`createTestBot` accepts every `createBot` option except `adapter`/`token` — `router`,
`plugins`, `middleware`, `commands`, `session`, `onError`… — so you test the real wiring.

| Member | Description |
|--------|-------------|
| `send(text)` | Send a message or `/command` as the user; resolves to the latest message |
| `click(label)` | Tap an inline button on the newest message that has it. Errors list the visible buttons |
| `event(type, raw?)` | Any other update, e.g. `event('poll_answer', { poll_answer: {...} })` |
| `lastMessage` | The most recently sent/edited message |
| `messages` | Every message in the chat with its latest content |
| `apiCalls` | Platform API calls made by hooks/conversations (`useMedia`, `useInvoice`, …) |
| `adapter` / `bot` | The underlying `MockAdapter` and bot |
| `stop()` | Shut down |

Each `TestMessage` has `text` (visible text, formatting stripped), `buttons`
(`{ text, data, url }[][]`), `replyKeyboard`, `type` (e.g. `'tg-photo'`), `edited`, and the raw
`output` tree.

Stub API results (e.g. to test error handling):

```ts
t.adapter.apiHandler = (method) => { if (method === "sendInvoice") throw new Error("boom"); return true; };
```

## `MockAdapter` — low level

```ts
import { MockAdapter } from "@teactjs/testing";

const adapter = new MockAdapter();
const bot = createBot({ component: App, adapter, token: "test" });
await bot.start();

await adapter.simulateMessage("123", "42", "/start");    // (chatId, userId, text)
await adapter.simulateCallback("123", "42", "__cb:…");   // defaults to the last sent message
await adapter.simulateEvent("123", "42", "poll_answer", { poll_answer: { option_ids: [0] } });

adapter.getLastSent();   // { chatId, messageId, output, threadId }
adapter.edited;          // every edit
adapter.apiCalls;        // every api.* call
adapter.reset();
```

## `renderBot` — a single component

Render a component in isolation (no bot, no adapter) and inspect the output tree.

```tsx
import { renderBot } from "@teactjs/testing";

const result = renderBot(Greeting, { text: "hi" });
result.findText();              // all visible text
result.findByType("tg-button"); // nodes of a host type
result.rerender({ text: "/help" });
result.unmount();
```
