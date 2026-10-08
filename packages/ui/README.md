# @teactjs/ui

Telegram UI components for Teact, including messages, inline and reply keyboards, media, polls and text formatting.

## Install

```bash
bun add @teactjs/ui @teactjs/core react
```

## Example

```tsx
import { useState } from '@teactjs/core';
import { Message, InlineKeyboard, Button, Alert, List } from '@teactjs/ui';

export function Team() {
  const [saved, setSaved] = useState(false);
  return (
    <>
      {saved && <Alert variant="success" title="Saved">Your team was stored.</Alert>}
      <List ordered>
        <List.Item>Pikachu</List.Item>
        <List.Item>Charizard</List.Item>
      </List>
      <Message text="Your team">
        <Message.Bold> (2/6)</Message.Bold>
        <InlineKeyboard columns={2}>
          <Button text="Save" variant="primary" onClick={() => setSaved(true)} />
          <Button text="Details" route="/pokemon/:id" params={{ id: 25 }} />
          <Button text="Docs" url="https://teact-docs.vercel.app" />
        </InlineKeyboard>
      </Message>
    </>
  );
}
```

## Components

| Component | Notes |
| --- | --- |
| `Message` | Takes `text`, `parseMode` (`'HTML'`, `'Markdown'` or `'MarkdownV2'`) and `disablePreview`. Children can be text, formatting or a keyboard. |
| `Bold`, `Italic`, `Code` (also `Message.Bold`, `Message.Italic`, `Message.Code`) | Inline formatting. These switch the message to HTML parse mode and escape your text. |
| `Alert`, `List` / `ListItem` (`List.Item`), `Divider` | Text blocks. `Alert` has the variants `info`, `warning`, `error` and `success`. |
| `InlineKeyboard`, `ButtonRow` (`InlineKeyboard.Row`, `Button.Row`) | Inline keyboard. A bare `<Button>` gets its own row, and `columns={n}` arranges buttons in a grid. |
| `Button` | Takes `text` plus one of `onClick` (a function or raw callback data), `route` with `params`, `url` or `conversation`. Also takes `variant`. |
| `WebAppButton` (`Button.WebApp`) | Opens a Telegram Mini App. |
| `ReplyKeyboard`, `ReplyRow`, `ReplyButton`, `RequestContactButton`, `RequestLocationButton`, `ReplyKeyboardRemove` | Custom reply keyboard. Also available as `ReplyKeyboard.Row`, `.Button`, `.RequestContact` and `.RequestLocation`. |
| `Photo`, `Video`, `Animation`, `Audio`, `Voice`, `VideoNote`, `Sticker`, `Document` | Media. `src` accepts a URL or a Telegram `file_id`. |
| `MediaGroup` + `MediaPhoto` / `MediaVideo` (`MediaGroup.Photo`, `MediaGroup.Video`) | Album. |
| `Location`, `LiveLocation` (`Location.Live`), `Venue` (`Location.Venue`), `Contact` | Places and contacts. |
| `Poll` (`Poll.Quiz`) | Regular and quiz polls. |
| `Notification` | Toast shown in answer to a button press. Set `showAlert` for a modal popup instead. |
| `SuspenseFallback` | Default "Loading…" message for `<Suspense>`. |
| `ErrorBoundary`, `useQuery`, `useMutation` | Re-exported from `@teactjs/core`. |

Every component also exports its props type, such as `MessageProps` and `ButtonProps`.

## Notes

- `Button` and `ButtonRow` must be inside an `<InlineKeyboard>`, and `ReplyButton` must be inside a `<ReplyKeyboard>`. Otherwise they throw an error that explains the problem.
- When a button has more than one action prop, the first one in this order applies: `url`, `route`, `conversation`, then `onClick`.
- `onClick` functions are stored in the process's memory. After a restart, or on serverless where every request may get a fresh instance, use `route` buttons or string callback data instead.
- `conversation="name"` starts a conversation from `conversationsPlugin` in `@teactjs/telegram`.
- Re-rendering the same screen edits the message in place, and the router's navigation modes decide whether a new message is sent instead.

## Docs

- [Package reference](https://teact-docs.vercel.app/docs/packages/ui)
- [Core package](https://teact-docs.vercel.app/docs/packages/core)

## License

MIT
