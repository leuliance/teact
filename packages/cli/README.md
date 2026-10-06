# @teactjs/cli

Command-line tool for Teact projects. Scaffold, develop, build, generate code, and diagnose issues.

Project files for `teact create` come from **`src/lib`**, synced from **`create-teact/lib`** on `prebuild`.

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
| `-t, --template <type>` | Template: `starter`, `showcase`, `counter`, `empty` (aliases: `router` → `starter`, `full` → `showcase`) |
| `-f, --features <list>` | Comma-separated features: `storage`, `conversations`, `streaming`, `auth`, `i18n`, `payments` |
| `--db <driver>` | Storage backend (implies `storage`): `file` (default), `memory`, `sqlite`, `redis`, `postgres` |
| `--pm <manager>` | Package manager: `bun`, `npm`, `pnpm` |
| `--no-install` | Skip dependency installation |

In interactive mode (TTY), the CLI prompts for template, feature plugins, storage backend (when Storage is picked), and package manager if flags are omitted. Dependency install streams output to your terminal.

**Templates:**

- **`starter`** (`router`) — Main menu + About; optional features add routes (Settings, Stream, Language, Store, etc.)
- **`showcase`** (`full`) — Demo app similar to `examples/showcase-bot`: Pokedex (react-query), component showcase, `commands.ts` with deep links and `/help` handler, route guards, `notFound`, middleware — with plugins toggled by your feature selection
- **`counter`** — Minimal counter bot with inline keyboard
- **`empty`** — Bare `createBot` + one `Message`, no router

### `teact dev`

Run the bot and reload it when files change. Under Bun this runs `bun --watch` on your entry
(the process restarts on each change, so timers, sockets and the previous poller never leak;
`.env` is loaded by Bun). Projects with a `vite.config.*` (or `--vite`) use vite-node instead.

```bash
teact dev
teact dev --hot --clear
teact dev --vite -e src/bot.tsx
```

| Flag | Description |
|------|-------------|
| `-e, --entry <file>` | Custom entry file (default: auto-detected) |
| `--hot` | Reload in-process with `bun --hot` (faster, but module side effects such as intervals or signal listeners survive reloads) |
| `--vite` | Use the vite-node pipeline |
| `--clear` | Clear the terminal on every reload |

### `teact build`

Bundle the bot into `dist/index.js` with `Bun.build` (Vite with `--vite` or a `vite.config.*`).
`@teactjs/*` packages are bundled; other dependencies stay external and load from `node_modules`
(so there is a single React instance).

```bash
teact build
teact build --target node --no-minify --no-sourcemap
teact build --standalone   # also bundle deps (grammY and DB clients stay external)
```

| Flag | Description |
|------|-------------|
| `-e, --entry <file>` | Custom entry file |
| `--target <bun\|node>` | Runtime to target (default `bun`) |
| `--standalone` | Bundle dependencies too |
| `--vite` | Build with Vite |
| `--no-minify` | Disable minification |
| `--no-sourcemap` | Disable source maps |

Run the result with `teact start`.

### `teact add <name...>`

Install an integration with your package manager (detected from the lockfile) and wire it into
`createBot({ plugins: [...] })` in your entry. If the file has an unexpected shape, nothing is
edited and the snippet is printed instead. Run `teact add` with no arguments to list everything.

```bash
teact add redis --client ioredis      # ioredis | redis | upstash | bun
teact add postgres --client neon      # pg | postgres | neon | pglite
teact add sqlite rate-limit logger
teact add mongodb --dry-run
```

### `teact routes`

List the routes declared with `createRouter()` under `src/`, with their component, co-located
command and guard (static analysis, nothing is executed). `--json` prints machine-readable output.

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

Runs all checks in parallel: Bun version, project files, `TELEGRAM_BOT_TOKEN` validity (`getMe`,
3s timeout), webhook status (warns when a webhook would swallow polling updates), `WEBHOOK_SECRET`
for webhook/edge deploys, duplicate React copies, mismatched `@teactjs/*` versions and missing
database client libraries. Use `--offline` to skip the network checks. Colors honour `NO_COLOR`.

## See Also

- [`create-teact`](../create-teact) for the interactive scaffolder (`bun create teact`)
- [Root README](../../README.md) for getting started
