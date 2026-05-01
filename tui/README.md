# Terminal User Interface (TUI)

Ei TUI is built with OpenTUI and SolidJS.

Coding tool integrations (OpenCode, Claude Code, Cursor): enable via `/settings` · export data via [CLI](../src/cli/README.md)

## How Ei Handles Configuration

Ei is designed to run consistently across machines and environments, so it keeps its own copy of your settings rather than reading from environment variables on every launch.

**On first run**, Ei reads environment variables like `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. to auto-configure providers for you. After that, those values are saved to Ei's local state (`~/.local/share/ei/state.json` by default) and the env vars are no longer consulted.

This means:

- **Rotating an API key?** Update it in Ei with `/provider`, not just in your shell.
- **Switching machines?** Your providers and settings travel with your state file (or via Sync), not your shell profile.
- **Changed your mind about a model?** Use `/provider` to set the model for a persona, or `/settings` to change your global default.
- **Updated sync credentials?** Use `/setsync <user> <pass>` — env vars won't be re-read.

The one exception is `EI_DATA_PATH` (and `EI_SYNC_USERNAME` / `EI_SYNC_PASSWORD` for bootstrapping sync on a new machine) — those are always read at startup since Ei needs them before it can load its own state.

## Coding Tool Integrations

Enable any or all three in `/settings`. They work independently and feed into the same knowledge base.

| Tool | Settings key | Session data location |
|------|-------------|----------------------|
| OpenCode | `opencode.integration: true` | OpenCode's local SQLite / JSON session store |
| Claude Code | `claudeCode.integration: true` | `~/.claude/projects/` (JSONL files) |
| Cursor | `cursor.integration: true` | `~/Library/Application Support/Cursor/User/` (macOS)<br>`%APPDATA%\Cursor\User\` (Windows)<br>`~/.config/Cursor/User/` (Linux) |

Sessions are processed oldest-first, one per queue cycle. On first run Ei works through your backlog gradually — it won't flood your LLM provider.

OpenCode also supports reading Ei's extracted knowledge back out via the [CLI tool](../src/cli/README.md), giving it persistent memory across sessions.

# Installation

```bash
# Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash

# Run Ei — no install needed, always the latest version
bunx ei-tui

# Or, if you use it as much as I do, add this to your profile!
alias ei='bunx ei-tui'
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
| `/reflect` | | Review a pending identity reflection (see badge on persona pill) |
| `/reflect generate` | | Write current + proposed YAML files to disk for editing |
| `/reflect update` | | Read edited `proposed.yaml` back into Ei |
| `/reflect apply` | | Apply the proposed identity to the persona |
| `/reflect dismiss` | | Discard without changing anything |

### Rooms

| Command | Aliases | Description |
|---------|---------|-------------|
| `/room` | `/r` | Open room picker overlay |
| `/room <name>` | `/r <name>` | Switch to a room by name |
| `/room new` | | Create a new room (opens `$EDITOR`) |
| `/room new <name>` | | Create a new room with a pre-filled name |
| `/capture` | | Force-extract quotes, topics, and people from current room now (bypasses threshold) |
| `/archive <name>` | | Archive a room by name |
| `/archive` | | List archived rooms (Enter to unarchive) |

Rooms have three modes, set at creation time:

| Mode | Badge | Description |
|------|-------|-------------|
| Free For All | `[FFA]` | All personas respond to every message |
| Choose Your Path | `[CYP]` | The conversation branches at each response; you navigate which path to follow |
| Messages Against Persona | `[MAP]` | Everyone submits a response; a Judge persona picks which one continues |

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
| `/me` | | Edit all your data (facts, topics, people) in `$EDITOR` |
| `/me <type>` | | Edit one type: `facts`, `topics`, or `people` |
| `/import <path>` | | Import a document (txt, md, pdf, etc.) into Ei — extracted knowledge is attributed to the "Emmett" persona |
| `/unsource <source_tag>` | | Remove all knowledge extracted from a previously imported document |
| `/dedupe <person\|topic> <term> [term2 ...]` | | Fuzzy-search and merge duplicate people or topics in `$EDITOR`. Unquoted words are individual OR terms; quoted strings match as exact phrases: `/dedupe person Flare "Jeremy Scherer"` finds records matching `Flare` OR `Jeremy Scherer` |
| `/settings` | `/set` | Edit your global settings in `$EDITOR` |
| `/setsync <user> <pass>` | `/ss` | Set sync credentials (triggers restart) |
| `/tools` | | Manage tool providers — enable/disable tools per persona |

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
