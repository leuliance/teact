# @teact/react

Telegram UI components for Teact. Each component maps to a Telegram message type and renders through the Teact reconciler.

## Install

```bash
bun add @teact/react
```

## Components

### Message

Send a text message. Supports `parseMode` (`"HTML"` | `"Markdown"` | `"MarkdownV2"`).

```tsx
<Message text="Hello, world!" parseMode="HTML" />
```

Children render as inline keyboard:

```tsx
<Message text="Pick one">
  <InlineKeyboard>
    <Button text="A" onClick={() => pick("a")} />
    <Button text="B" onClick={() => pick("b")} />
  </InlineKeyboard>
</Message>
```

### InlineKeyboard, ButtonRow, Button

Declarative inline keyboards. Buttons support `onClick` (callback or string), `url`, and `conversation` triggers.

```tsx
<InlineKeyboard>
  <ButtonRow>
    <Button text="Visit" url="https://example.com" />
    <Button text="Start chat" conversation="onboarding" />
  </ButtonRow>
</InlineKeyboard>
```

Compound syntax: `InlineKeyboard.Row`, `InlineKeyboard.Button`.

### WebAppButton

Opens a Telegram Web App.

```tsx
<WebAppButton text="Open App" url="https://my-webapp.com" />
```

### Photo

```tsx
<Photo src="https://example.com/image.jpg" caption="A nice photo" hasSpoiler />
```

### Video

```tsx
<Video src="./clip.mp4" caption="Watch this" width={640} height={480} supportsStreaming />
```

### Animation, Voice, Audio, VideoNote, Sticker, Document

```tsx
<Audio src="./song.mp3" title="My Song" performer="Artist" duration={180} />
<Sticker src="./sticker.webp" emoji="fire" />
<Document src="./report.pdf" filename="report.pdf" caption="Monthly report" />
```

### Contact

```tsx
<Contact phoneNumber="+1234567890" firstName="Alice" lastName="Smith" />
```

### Location, LiveLocation, Venue

```tsx
<Location lat={40.7128} lon={-74.006} />
<LiveLocation lat={40.7128} lon={-74.006} livePeriod={3600} />
<Venue lat={40.7128} lon={-74.006} title="Central Park" address="New York, NY" />
```

Compound syntax: `Location.Live`, `Location.Venue`.

### MediaGroup

Group multiple photos and videos into a single message.

```tsx
<MediaGroup>
  <MediaPhoto src="./a.jpg" caption="First" />
  <MediaVideo src="./b.mp4" caption="Second" />
</MediaGroup>
```

Compound syntax: `MediaGroup.Photo`, `MediaGroup.Video`.

### ReplyKeyboard

Custom keyboard that replaces the user's default keyboard.

```tsx
<ReplyKeyboard resizeKeyboard oneTimeKeyboard placeholder="Choose...">
  <ReplyRow>
    <ReplyButton text="Option A" />
    <ReplyButton text="Option B" />
  </ReplyRow>
  <ReplyRow>
    <RequestContactButton text="Share contact" />
    <RequestLocationButton text="Share location" />
  </ReplyRow>
</ReplyKeyboard>
```

Use `<ReplyKeyboardRemove />` to remove it.

### Poll

```tsx
<Poll question="Favorite color?" options={["Red", "Blue", "Green"]} />
```

Quiz variant with `Poll.Quiz`:

```tsx
<Poll.Quiz question="2 + 2?" options={["3", "4", "5"]} correctOptionId={1} />
```

### Notification

Answer a callback query with a toast or alert.

```tsx
<Notification text="Saved!" showAlert />
```

### Formatting

```tsx
<Message text={<>
  <Bold>Important:</Bold> Use <Code language="typescript">useState</Code> for state.
  <Italic>Simple as that.</Italic>
</>} />
```

### Alert, List, Divider

```tsx
<Alert variant="warning" title="Heads up">Something happened</Alert>

<List ordered>
  <ListItem>First</ListItem>
  <ListItem>Second</ListItem>
</List>

<Divider char="=" length={30} />
```

### SuspenseFallback

Placeholder while a `<Suspense>` boundary resolves.

```tsx
<SuspenseFallback text="Loading data..." />
```

### ErrorBoundary

Catches render errors in child components.

```tsx
<ErrorBoundary fallback={<Message text="Something went wrong" />} onError={console.error}>
  <RiskyComponent />
</ErrorBoundary>
```

## Data Hooks

### useQuery

```tsx
const { data, isLoading, error, refetch } = useQuery({
  key: "pokemon",
  fn: () => fetchPokemon(id),
  staleTime: 60_000,
  refetchInterval: 30_000,
});
```

### useMutation

```tsx
const { mutate, isLoading, error, reset } = useMutation({
  fn: (name: string) => createUser(name),
  onSuccess: (user) => console.log("Created", user),
});
```

## See Also

- [`@teact/core`](../core) for the barrel import
- [`@teact/runtime`](../runtime) for runtime hooks
