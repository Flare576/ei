# Terminal User Interface (TUI)

Ei TUI is built with OpenTUI and SolidJS.

OpenCode integration: import via `/settings` (`opencode.integration: true`) · export via [CLI](../src/cli/README.md)

# Installation

```bash
# Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash

# Install Ei
npm install -g ei-tui
```

## TUI Commands

All commands start with `/`. Append `!` to any command as a shorthand for `--force` (e.g., `/quit!`).

### Navigation & App

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | `/h` | Show the command list and keybindings |
| `/quit` | `/q` | Save, sync, and exit |
| `/quit!` | `/q!` | Force quit without syncing |

### Personas

| Command | Aliases | Description |
|---------|---------|-------------|
| `/persona` | `/p` | Open persona picker overlay |
| `/persona <name>` | `/p <name>` | Switch to a persona by name or alias |
| `/persona new <name>` | `/p new <name>` | Create a new persona (opens `$EDITOR`) |
| `/details` | `/d` | Edit the current persona in `$EDITOR` |
| `/details <name>` | `/d <name>` | Edit a specific persona in `$EDITOR` |
| `/archive` | | List archived personas (Enter to unarchive) |
| `/archive <name>` | | Archive a persona by name |
| `/unarchive <name>` | | Unarchive a persona and switch to it |
| `/delete` | `/del` | Pick a persona to permanently delete |
| `/delete <name>` | `/del <name>` | Permanently delete a persona by name (confirms) |
| `/pause` | | Pause current persona indefinitely |
| `/pause <duration>` | | Pause for a duration: `2h`, `1d`, `1w`, `30m` |
| `/resume` | `/unpause` | Resume the current paused persona |
| `/resume <name>` | `/unpause <name>` | Resume a specific paused persona |

### Providers & Models

| Command | Aliases | Description |
|---------|---------|-------------|
| `/provider` | `/providers` | Open provider picker (select, edit, or create) |
| `/provider <name>` | | Set a provider on the active persona by name |
| `/provider new` | | Create a new LLM provider (opens `$EDITOR`) |
| `/model <model>` | | Set model for active persona (e.g., `sonnet-latest`) |
| `/model <provider:model>` | | Set provider + model explicitly (e.g., `openai:gpt-4o`) |

### Messages & Context

| Command | Aliases | Description |
|---------|---------|-------------|
| `/new` | | Toggle context boundary (fresh conversation start) |
| `/context` | `/messages` | Edit message context status in `$EDITOR` |
| `/quotes` | `/quote` | Open all quotes in `$EDITOR` |
| `/quotes me` | | Open only your (human) quotes |
| `/quotes <N>` | | View/edit quotes attached to message number N |
| `/quotes search "term"` | | Search quotes by keyword |
| `/quotes <persona>` | | View/edit quotes attributed to a specific persona |

### Data & Settings

| Command | Aliases | Description |
|---------|---------|-------------|
| `/me` | | Edit all your data (facts, traits, topics, people) in `$EDITOR` |
| `/me <type>` | | Edit one type: `facts`, `traits`, `topics`, or `people` |
| `/settings` | `/set` | Edit your global settings in `$EDITOR` |
| `/setsync <user> <pass>` | `/ss` | Set sync credentials (triggers restart) |

### Editor

| Command | Aliases | Description |
|---------|---------|-------------|
| `/editor` | `/e`, `/edit` | Open current input text in `$EDITOR`, update on save |

### Queue & Debugging

| Command | Aliases | Description |
|---------|---------|-------------|
| `/queue` | | Pause queue and inspect/edit active items in `$EDITOR` |
| `/dlq` | | Inspect and recover failed (dead-letter) queue items in `$EDITOR` |

### Keybindings

| Key | Action |
|-----|--------|
| `Escape` | Abort current operation / resume queue |
| `Ctrl+C` | Clear input (second press exits) |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+E` | Open `$EDITOR` (preserves current input) |
| `PageUp / PageDown` | Scroll message history |

# Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EI_DATA_PATH` | `~/.local/share/ei` | Path to Ei's persistent data directory. Set this to keep multiple profiles or point to a shared/synced folder. |
| `XDG_DATA_HOME` | `~/.local/share` | XDG base directory. Ignored if `EI_DATA_PATH` is set. |
| `EI_SYNC_USERNAME` | — | Username for remote sync. If set at startup, bootstraps sync credentials automatically (useful for dotfiles/scripts). |
| `EI_SYNC_PASSPHRASE` | — | Passphrase for remote sync. Paired with `EI_SYNC_USERNAME`. |
| `EDITOR` / `VISUAL` | `vi` | Editor opened by `/details`, `/me`, `/settings`, `/context`, `/quotes`, etc. Falls back to `VISUAL` if `EDITOR` is unset. |

> **Tip**: `tail -f $EI_DATA_PATH/tui.log` to watch live debug output.


# Development

## Requirements

- [Bun](https://bun.sh) - Fast JavaScript runtime
- [NVM](https://github.com/nvm-sh/nvm) - Required for E2E testing (see below)

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

## Testing

### Unit Tests

```bash
bun run test
```

### E2E Tests

E2E tests use `@microsoft/tui-test` which requires **Node 20** due to native PTY dependencies.

The npm scripts handle version switching automatically via NVM:

```bash
npm run test:e2e        # Run all E2E tests
npm run test:e2e:debug  # Run with debug output
```

If running manually without the scripts:

```bash
unset npm_config_prefix  # May be needed if using Homebrew
source ~/.nvm/nvm.sh && nvm use 20
npm rebuild  # Rebuild native modules for Node 20 (first time only)
npx @microsoft/tui-test
```
