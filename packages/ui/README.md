# @teact/ui

Convenience re-exports of all components and hooks from `@teact/react`.

This package exists so you can import UI primitives from a dedicated namespace if you prefer to keep runtime and UI imports separate.

## Install

```bash
bun add @teact/ui
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
} from "@teact/ui";
```

Every component, prop type, and data hook exported by `@teact/react` is available here with the same names and signatures.

## When to Use This vs @teact/react

They are identical. Use whichever you prefer:

- `@teact/ui` -- if you want a short, UI-focused import path
- `@teact/react` -- if you want to be explicit about the source package
- `@teact/core` -- if you want everything (runtime + components) from one import

## See Also

- [`@teact/react`](../react) for the full component catalog
- [`@teact/core`](../core) for the barrel import
