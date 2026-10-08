# @teactjs/testing

Testing utilities for Teact bots: `MockAdapter` runs a real `createBot` without Telegram, and `renderBot` renders a single component for assertions.

## Install

```bash
bun add -d @teactjs/testing @teactjs/core @teactjs/ui react
```

## Example: a full bot with `MockAdapter`

```tsx
import { describe, test, expect } from 'bun:test';
import { createBot, createI18n, useLocale, useState } from '@teactjs/core';
import { Message, InlineKeyboard, Button } from '@teactjs/ui';
import { MockAdapter } from '@teactjs/testing';

function Counter() {
  const [n, setN] = useState(0);
  return (
    <Message text={`count: ${n}`}>
      <InlineKeyboard>
        <Button text="+1" onClick={() => setN((c) => c + 1)} />
      </InlineKeyboard>
    </Message>
  );
}

describe('Counter', () => {
  test('increments on click', async () => {
    const adapter = new MockAdapter();
    const bot = createBot({ component: Counter, adapter }); // no token needed
    await bot.start();

    await adapter.simulateMessage('chat-1', 'user-1', 'hi');
    const sent = adapter.getLastSent()!;
    expect(sent.output.props.text).toBe('count: 0');

    const button = sent.output.children[0].children[0]; // tg-keyboard → tg-button (a bare <Button> is its own row)
    await adapter.simulateCallback('chat-1', 'user-1', button.props.callbackData, '1');
    expect(adapter.getLastEdited()?.output.props.text).toBe('count: 1');

    await bot.stop();
  });

  test('detects the user language', async () => {
    const i18n = createI18n({
      defaultLocale: 'en',
      resources: { en: { translation: { hi: 'Hello' } }, pt: { translation: { hi: 'Olá' } } },
    });
    function Hi() {
      const { t } = useLocale();
      return <Message text={t('hi')} />;
    }
    const adapter = new MockAdapter();
    const bot = createBot({ component: Hi, adapter, providers: i18n.Provider });
    await bot.start();

    await adapter.simulateMessage('chat-2', 'user-2', 'hi', { languageCode: 'pt-br' });
    expect(adapter.getLastSent()?.output.props.text).toBe('Olá');

    await bot.stop();
  });
});
```

## Example: rendering a component with `renderBot`

```tsx
import { test, expect } from 'bun:test';
import { useBot } from '@teactjs/core';
import { Message } from '@teactjs/ui';
import { renderBot } from '@teactjs/testing';

function Greeting() {
  const { user } = useBot();
  return <Message text={`Hello ${user.firstName}`} />;
}

test('greets the user', async () => {
  const r = renderBot(Greeting, { user: { id: '1', firstName: 'Ash', platform: 'mock' } });
  await new Promise((resolve) => setTimeout(resolve, 10)); // the reconciler commits asynchronously
  expect(r.findText()).toBe('Hello Ash');
  expect(r.findByType('tg-message')).toHaveLength(1);
  r.unmount();
});
```

## Main exports

| Export | Purpose |
| --- | --- |
| `MockAdapter` | An `Adapter` that records output and simulates incoming updates. `requiresToken = false`, so `createBot` needs no bot token. |
| `adapter.simulateMessage(chatId, userId, text, opts?)` | Sends an incoming text message. Each one gets a unique `messageId`. |
| `adapter.simulateCallback(chatId, userId, data, messageId?, opts?)` | Simulates a button press with the given `callback_data`. |
| `opts.languageCode` (`SimulateOptions`) | The sender's Telegram `language_code`, such as `'de'` or `'pt-br'`. |
| `adapter.sent`, `adapter.edited`, `adapter.cleared`, `adapter.commands` | Recorded sends (`SentMessage`), edits (`EditedMessage`), cleared keyboards and the registered command menu. |
| `adapter.getLastSent()`, `adapter.getLastEdited()`, `adapter.reset()` | Convenience accessors, and `reset()` to clear the recorded sends and edits. |
| `adapter.webhookCallback()` | Accepts a JSON body of `{ text }` or `{ callbackData }` (sent as chat `1`), for testing `bot.fetch()`. |
| `renderBot(Component, ctx?)` | Renders a component inside a runtime context with an in-memory session. Returns `RenderResult`, with `output`, `rerender(ctxOverrides)`, `unmount()`, `findByType(type)` and `findText()`. |

## Notes

- `simulateMessage` and `simulateCallback` resolve after the update has been fully handled, including middleware, render and send, just as the real Telegram adapter does. Await them and then assert.
- Output is the serialized `OutputNode` tree, with node types such as `tg-message`, `tg-keyboard`, `tg-button-row` and `tg-button`. If a component returns a fragment with several top-level elements, the tree is wrapped in a `#root` node. A button's `props.callbackData` is what you pass to `simulateCallback`.
- `renderBot` commits asynchronously, so `output` is `null` until the first commit. Wait a tick before you assert.
- `renderBot` does not run a router, plugins or middleware. To test those, use `createBot` with `MockAdapter`.

## Docs

- [Package reference](https://teact-docs.vercel.app/docs/packages/testing)

## License

MIT
