# @teactjs/ui

Convenience re-exports of all components and hooks from `@teactjs/react`.

This package exists so you can import UI primitives from a dedicated namespace if you prefer to keep runtime and UI imports separate.

## Install

```bash
bun add @teactjs/ui
```

## Usage

```tsx
import {
  Message,
  Button,
  InlineKeyboard,
  Photo,
  ErrorBoundary,
  useQuery,
  useMutation,
} from "@teactjs/ui";
```

Every component, prop type, and data hook exported by `@teactjs/react` is available here with the same names and signatures.

## When to Use This vs @teactjs/react

They are identical. Use whichever you prefer:

- `@teactjs/ui` -- if you want a short, UI-focused import path
- `@teactjs/react` -- if you want to be explicit about the source package
- `@teactjs/core` -- if you want everything (runtime + components) from one import

## Formatting

`<Bold>`, `<Italic>`, `<Underline>`, `<Strike>`, `<Spoiler>`, `<Code language>`, `<Link href>`,
`<Mention userId>`, `<Quote expandable>` — rendered as Telegram HTML with user text escaped
automatically.

```tsx
<Message>
  Hi <Mention userId={user.id}>{user.firstName}</Mention>! Your code is <Spoiler>4242</Spoiler>.
  Read the <Link href="https://teact-docs.vercel.app">docs</Link>.
</Message>
```

## Pagination & confirm dialogs

```tsx
const pager = usePagination(products, { pageSize: 5 });
<Message text={pager.items.map((p) => p.name).join("\n")}>
  <InlineKeyboard>
    <Pagination page={pager.page} pageCount={pager.pageCount} onChange={pager.goTo} />
  </InlineKeyboard>
</Message>

<Confirm text="Delete your account?" destructive onConfirm={remove} onCancel={back} />
```

## See Also

- [`@teactjs/react`](../react) for the full component catalog
- [`@teactjs/core`](../core) for the barrel import
