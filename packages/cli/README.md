# @teactjs/cli

Command-line tool for Teact projects. Scaffold, develop, build, generate code, and diagnose issues.

## Install

Installed automatically with `@teactjs/core`. You can also install it directly:

```bash
bun add -d @teactjs/cli
```

## Commands

### `teact create <name>`

Scaffold a new Teact bot project.

```bash
teact create my-bot
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-t, --template <type>` | Template: `router`, `counter`, `full`, `empty` |
| `-f, --features <list>` | Comma-separated features: `storage`, `conversations`, `streaming`, `auth` |
| `--pm <manager>` | Package manager: `bun`, `npm`, `pnpm` |
| `--no-install` | Skip dependency installation |

In interactive mode (TTY), the CLI prompts for template, features, and package manager if flags are omitted.

**Templates:**

- **`counter`** -- minimal counter bot with inline keyboard
- **`router`** -- multi-page bot with routing
- **`full`** -- complete setup with storage, conversations, streaming, and auth
- **`empty`** -- bare project with no components

### `teact dev`

Start the development server with HMR (powered by Vite and vite-node).

```bash
teact dev
teact dev -e src/bot.tsx
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-e, --entry <file>` | Custom entry file (default: auto-detected) |

### `teact build`

Build the bot for production.

```bash
teact build
teact build --no-minify --no-sourcemap
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-e, --entry <file>` | Custom entry file |
| `--no-minify` | Disable minification |
| `--no-sourcemap` | Disable source maps |

Output is written to `dist/`.

### `teact generate <type> <name>` (alias: `teact g`)

Generate boilerplate code.

```bash
teact generate component UserProfile
teact g hook useSettings
teact g plugin analytics
```

**Types:**

| Type | Generates |
|------|-----------|
| `component` | A new Teact component file |
| `hook` | A new custom hook file |
| `plugin` | A new plugin scaffold |

### `teact doctor`

Check your environment and project configuration for common issues.

```bash
teact doctor
```

Validates Bun/Node versions, dependencies, TypeScript config, and project structure.

## See Also

- [`create-teact`](../create-teact) for the interactive scaffolder (`bun create teact`)
- [Root README](../../README.md) for getting started
