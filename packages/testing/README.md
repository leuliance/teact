# @teactjs/testing

Test utilities for Teact bots. Provides a mock adapter and a render helper for unit testing components without a live Telegram connection.

## Install

```bash
bun add -d @teactjs/testing
```

## MockAdapter

A fake adapter that records all sent and edited messages.

```ts
import { MockAdapter } from "@teactjs/testing";

const adapter = new MockAdapter();

// Use it in place of TelegramAdapter
const bot = createBot({
  component: App,
  adapter,
  token: "test-token",
});

await bot.start();

// Simulate user input
adapter.simulateMessage({ chatId: 123, text: "/start" });
adapter.simulateCallback({ chatId: 123, data: "increment" });

// Inspect outputs
adapter.getLastSent();    // most recent SentMessage
adapter.getLastEdited();  // most recent EditedMessage
adapter.sent;             // full array of SentMessage[]
adapter.edited;           // full array of EditedMessage[]

// Reset between tests
adapter.reset();
```

### SentMessage / EditedMessage

```ts
interface SentMessage {
  chatId: number;
  output: OutputNode;
}

interface EditedMessage {
  chatId: number;
  messageId: number;
  output: OutputNode;
}
```

## renderBot

Render a component in isolation and inspect the output tree.

```tsx
import { renderBot } from "@teactjs/testing";

function Counter({ ctx }: { ctx: BotContext }) {
  const [count, setCount] = useState(0);
  return (
    <Message text={`Count: ${count}`}>
      <InlineKeyboard>
        <Button text="+1" onClick={() => setCount(count + 1)} />
      </InlineKeyboard>
    </Message>
  );
}

const result = renderBot(Counter);

// Read the rendered output tree
result.output;

// Find nodes by type
const buttons = result.findByType("tg-button");

// Find text content
const text = result.findText();

// Re-render with new context
result.rerender({ text: "/help" });

// Clean up
result.unmount();
```

### RenderResult API

| Method | Description |
|--------|-------------|
| `output` | Getter -- current `OutputNode` tree |
| `rerender(ctxOverrides?)` | Re-render with optional context overrides |
| `unmount()` | Unmount the component tree |
| `findByType(type, node?)` | Find all nodes matching a host type (e.g. `"tg-button"`) |
| `findText(node?)` | Collect all text content from the tree |

## Example Test (Vitest)

```ts
import { describe, it, expect } from "vitest";
import { MockAdapter } from "@teactjs/testing";
import { createBot } from "@teactjs/core";
import App from "./App";

describe("Bot", () => {
  it("responds to /start", async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ component: App, adapter, token: "test" });
    await bot.start();

    adapter.simulateMessage({ chatId: 1, text: "/start" });

    const last = adapter.getLastSent();
    expect(last).toBeDefined();
  });
});
```

## See Also

- [`@teactjs/core`](../core) for the barrel import
- [`@teactjs/runtime`](../runtime) for `createBot`
