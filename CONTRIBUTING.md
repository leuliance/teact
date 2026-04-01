# Contributing to Teact

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Node.js](https://nodejs.org) >= 20
- Git

## Setup

```bash
git clone https://github.com/your-org/teact.git
cd teact
bun install
```

This installs all dependencies across the monorepo.

## Monorepo Structure

```
teact/
  packages/
    core/          # @teactjs/core -- barrel re-exports
    react/         # @teactjs/react -- Telegram UI components
    runtime/       # @teactjs/runtime -- bot engine, hooks, routing
    renderer/      # @teactjs/renderer -- React reconciler (private)
    ui/            # @teactjs/ui -- convenience re-exports
    telegram/      # @teactjs/telegram -- grammY adapter
    storage/       # @teactjs/storage -- persistent storage plugin
    testing/       # @teactjs/testing -- test utilities
    cli/           # @teactjs/cli -- CLI tool
    create-teact/  # create-teact -- project scaffolder
  examples/
    showcase-bot/  # Full-featured example
```

Packages use Bun workspaces. Cross-package imports use `@teactjs/*` aliases resolved via the root `tsconfig.json` path mappings.

## Common Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start the dev server (runs the CLI `dev` command) |
| `bun test` | Run all tests |
| `bun run build` | Build all packages |
| `bun run typecheck` | Type-check the entire monorepo |
| `bun run clean` | Remove all `dist/` directories |

## Running Tests

```bash
bun test
```

Tests use Vitest. The `@teactjs/testing` package provides `MockAdapter` and `renderBot` for unit testing components without a live Telegram connection.

To run tests for a specific package:

```bash
bun test packages/runtime
```

## Adding a New Feature

1. Identify which package the feature belongs to. Most features go in `@teactjs/runtime` (hooks, middleware) or `@teactjs/react` (components).
2. Implement the feature in the appropriate `src/` directory.
3. Export it from the package's `src/index.ts`.
4. If it should be part of the public API, also export it from `@teactjs/core`'s `src/index.ts`.
5. Add tests.
6. Update type exports if new interfaces or types are introduced.

### Adding a New Component

Create the component in `packages/react/src/components.ts` following existing patterns. Each component maps to a `tg-*` host type handled by the renderer. Export it from the package index.

### Adding a New Hook

Create the hook in the relevant file under `packages/runtime/src/`. Export it from the package index and from `@teactjs/core`.

## Creating a Plugin

Plugins implement the `TeactPlugin` interface:

```ts
import type { TeactPlugin } from "@teactjs/core";

export function myPlugin(options?: MyOptions): TeactPlugin {
  return {
    name: "my-plugin",
    onStart: (bot) => {
      // Called when the bot starts
    },
    middleware: (ctx, next) => {
      // Runs on every update
      return next();
    },
    Provider: ({ children }) => {
      // Wraps the component tree with context
      return <MyContext.Provider value={state}>{children}</MyContext.Provider>;
    },
    onStop: () => {
      // Cleanup
    },
  };
}
```

Place standalone plugins in their own package under `packages/`. Register them via the `plugins` array in `createBot` or `teact.config.ts`.

## Pull Request Guidelines

1. Fork the repository and create a feature branch from `main`.
2. Keep PRs focused -- one feature or fix per PR.
3. Include tests for new functionality.
4. Run `bun test` and `bun run typecheck` before submitting.
5. Write a clear PR description explaining what changed and why.
6. Reference any related issues.

## Changeset Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

When your PR includes user-facing changes:

```bash
bun changeset
```

Follow the prompts to select affected packages and describe the change. This creates a changeset file in `.changeset/`. Commit it with your PR.

Maintainers run `bun run version` to consume changesets and bump versions, then `bun run release` to publish.

## Code Style

- TypeScript strict mode.
- No default exports (except for config files).
- Prefer named exports.
- Keep files focused -- one major export per file when possible.

## Questions?

Open an issue or start a discussion on GitHub.
