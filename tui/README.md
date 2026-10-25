# Terminal User Interface (TUI)

Ei TUI is built with OpenTUI and SolidJS.

Coding tool integrations ([supported tools](#coding-tool-integrations)): enable via `/settings` · export data via [CLI](../src/cli/README.md)

## What do you want to do?

**Give my coding tools persistent memory** — Enable integrations in `/settings`, then let the onboarding wizard (or `/onboarding` anytime) wire up the hooks. Accepting the wizard's install step also turns on importing for the coding tools it detects (see [Installation](#installation)). [Jump to Coding Tool Integrations →](#coding-tool-integrations)

**Personalize my AI agents** — Create personas, set traits and topics, let them evolve. [Jump to Installation →](#installation) then come back for [Persona setup in the root README](../README.md#whats-a-persona)

**Chat with a Persona** — Full TUI experience — heartbeats, rooms, the whole thing. [Jump to Installation →](#installation)

## Installation

You need Bun to run the TUI:

```bash
# Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash
```

But the TUI itself doesn't need to be "installed":

```bash
# Run Ei — no install needed, always the latest version
bunx ei-tui

# Or, if you use it as much as I do, add this to your profile!
alias ei='bunx ei-tui'
```

**BUT**, if you want to wire Ei's knowledge base to your coding tools, run Ei and step through the onboarding wizard:

```bash
# The wizard detects Cursor, Claude Code, OpenCode, Codex, etc. and installs
# context injection hooks for each. Re-run it anytime with /onboarding.
bunx ei-tui
```

Accepting the wizard's install step also turns on importing (`integration: true`) for every Claude Code, Cursor, Codex, Pi, and OMP install it detects, so Ei starts reading those transcripts and sending them to your extraction model. Turn any of them back off in `/settings`. OpenCode's importer is not switched on by the wizard.

**Upgrading:** if you already have a provider configured and `local.json` in your data directory either records an `installed_version` that differs from the version you're now running or has no `installed_version` at all (an existing install that predates the record, or one set up with an older `ei --install`), Ei asks whether to install the latest skills, hooks, and integrations. Accepting runs the same install as `ei --install`, which removes any `ei` MCP registration from Claude Code and Cursor and runs `codex mcp remove ei` for Codex (see the [CLI README](../src/cli/README.md#mcp-server)), then records the running version. Dismissing doesn't record the new version, so you're asked again on every launch until you accept. With no provider configured, first launch goes to the onboarding wizard instead.

## Coding Tool Integrations

Enable any or all of them in `/settings`. They work independently and feed into the same knowledge base.

| Tool | Settings key | Session data location |
|------|-------------|----------------------|
| OpenCode | `opencode.integration: true` | OpenCode's local SQLite / JSON session store |
| Claude Code | `claudeCode.integration: true` | `~/.claude/projects/` (JSONL files) |
| Cursor | `cursor.integration: true` | `~/Library/Application Support/Cursor/User/` (macOS)<br>`%APPDATA%\Cursor\User\` (Windows)<br>`~/.config/Cursor/User/` (Linux) |
| Codex | `codex.integration: true` | `~/.codex/state_*.sqlite` + `~/.codex/sessions/` rollout JSONL files |
| Pi | `pi.integration: true` | `~/.pi/agent/sessions/` — JSONL files |
| OMP | `omp.integration: true` | `~/.omp/agent/sessions/` — JSONL files |

Sessions are processed oldest-first, one per queue cycle. On first run Ei works through your backlog gradually — it won't flood your LLM provider. A single large session still queues all of its extraction scans at once. OMP is the exception: it imports one block at a time, continuing while the queue is idle, and its first run covers every session tree under `~/.omp/agent/sessions`, so expect a long first run. OMP is its own integration — it no longer runs under the Pi toggle, so enable `omp.integration` explicitly if you want it.

All of these tools also support reading Ei's knowledge back out via the [CLI tool](../src/cli/README.md). Run `bunx ei-tui` and step through the onboarding wizard (or re-run it anytime with `/onboarding`) to wire up context injection everywhere it's detected. MCP itself is disabled by default on Claude Code, Cursor, and Codex — see the [CLI README](../src/cli/README.md#mcp-server) for manual MCP setup.

## Slack Integration

Slack is different from the coding tool integrations — it reads human conversations rather than coding sessions, and requires OAuth instead of local file access.

**Setup:**

```
/auth slack
```

This opens a browser, walks you through OAuth, and stores your token. Then enable it for your workspace in `/settings` — the toggle lives under `slack.workspaces.<workspace-id>`, not at the top level of `slack`:

```yaml
slack:
  workspaces:
    <workspace-id>:
      integration: true
      extraction_model: default  # optional override
```

Ei will index channels and DMs you're a member of, extracting topics, people, and context. Everything is processed locally — nothing is sent to the developer.

**Notes:**
- Ei uses a [published Slack app](https://github.com/Flare576/ei) — your workspace admin may need to approve it
- Non-Marketplace apps are subject to Slack's rate limits on `conversations.history` (1 req/min). Backfill is gradual; steady-state is fast.
- Your workspace admin may need to approve the [Ei Slack app](https://slack.com/oauth/v2/authorize?client_id=11080256060354.11080294064034&scope=&user_scope=channels:history,channels:read,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read,users:read.email) — that link goes directly to the install flow
- The Slack app is read-only — Ei never posts, reacts, or takes any action in your workspace

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
| `/persona new <name>` | `/p new <name>` | Create a new persona: describe it in `$EDITOR`, Ei generates traits and topics from that description, then you review and edit the result in a second editor before it's created |
| `/persona update <persona> [person]` | `/p update <persona> [person]` | Regenerate a persona's descriptions, aliases, traits, and topics from a linked Person, after a review in `$EDITOR`. Traits and topics are replaced wholesale |
| `/details` | `/d` | Edit the current persona in `$EDITOR`. Each trait has a `strength` from 0 to 1 (default 0.5); 0 means "never do this" and is shown to the persona as a never-do rule. `show_thinking` controls whether its thinking is displayed (on unless set to false) |
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
| `/toolcalls` | | Show the tool calls behind the most recent persona message (1:1 conversations only) |
| `/toolcalls <N>` | | Show the tool calls behind message number N (same numbering as `/quotes <N>`; 1:1 conversations only) |
| `/thinking` | | Toggle whether the active persona's thinking is shown above its replies (1:1 conversations only) |

A persona message whose turn called tools shows 🔧 in its header when every call went to a tool classified as read-only (it only reads or looks something up), or 🧧 when at least one call went to a tool classified as a write — one that can change something, such as the persona's own traits, topics, description, or notes, or the status of one of its signals. The icon reports that classification, not an outcome: a call is listed whenever it got a result, including a call to a tool that doesn't exist, one refused because the tool had used up its calls for the turn, and one that failed, so 🧧 doesn't mean anything was actually written. A tool with no classification (an unknown tool, or a custom tool without a `kind`) counts as a write; a custom tool marked `kind: "read"` stays read-only. A message that came with model thinking also shows 💭.

`/toolcalls` with no number looks only at the most recent persona message; `/toolcalls <N>` looks only at message N — the number after ✂️ in each message header, the same numbering `/quotes <N>` uses. If that message has no tool calls (or, for `<N>`, is one of your own messages), you get "There are no tool calls on this message [N]" and nothing opens; it never falls back to an older message that has some. An `N` that isn't a message number gets "No message at index [N]". The overlay lists each call in order: its name (and `action`, when it has one), the error flag, every argument in full, and the saved result, which is cut to 150 characters plus `... (truncated)`. The error flag is passed through exactly as the tool layer set it and can be `false` even when the result describes an error, so read the result too. Inside the overlay, `j`/`k` or the arrow keys scroll, `PgUp`/`PgDn` page, and `Esc` or `q` closes. Thinking visibility is a per-persona setting, on by default — `/thinking` flips it, or set `show_thinking` in `/details`. Both commands only work in 1:1 conversations, not while a Room is active.

### Data & Settings

| Command | Aliases | Description |
|---------|---------|-------------|
| `/me` | | Edit all your data (facts, topics, people) in `$EDITOR` |
| `/me <type>` | | Edit one type: `facts`, `topics`, or `people` |
| `/import <path>` | | Import a document (txt, md, pdf, etc.) into Ei — extracted knowledge is attributed to the "Emmett" persona |
| `/unsource <source_tag>` | | Remove all knowledge extracted from a previously imported document |
| `/generate <subject>` | | Synthesize everything Ei knows about a subject into a markdown document — lands in `$EI_DATA_PATH/docs/` automatically |
| `/generate` | | (no args) Manage your generated documents — re-run, re-export, or delete |
| `/dedupe <person\|topic> <term> [term2 ...]` | | Fuzzy-search and merge duplicate people or topics in `$EDITOR`. Unquoted words are individual OR terms; quoted strings match as exact phrases: `/dedupe person Flare "Jeremy Scherer"` finds records matching `Flare` OR `Jeremy Scherer` |
| `/settings` | `/set` | Edit your global settings in `$EDITOR`. Settings that make no operational sense are rejected on save: heartbeat intervals (`default_heartbeat_ms`, a persona's `heartbeat_delay_ms`) must be at least 5 minutes, and zero or negative values are rejected for the other interval, window, and backup settings |
| `/setsync <user> <pass>` | `/ss` | Set sync credentials (triggers restart) |
| `/tools` | | Enable or disable tool providers and their tools for everyone. To choose a persona's tools, edit it in `/details` |
| `/auth <service>` | | Authenticate with an external service via OAuth. Supported: `spotify`, `slack` |

> Disabling a tool provider hides its tools from `/details`' YAML editor, but doesn't revoke them — a persona's grants for a disabled provider's tools survive an unrelated `/details` edit and reappear once you re-enable the provider with `/tools`.

**Rolling backups** are off by default and run only in the TUI. Turn them on with `backup.enabled: true` in `/settings`: every `interval_ms` (default one hour) Ei writes a full copy of your state to the `backups/` folder in your data directory and keeps the newest `max_backups` (default 24), so disk use scales with the size of your state.

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

## How Ei Handles Configuration

Ei is designed to run consistently across machines and environments, so it keeps its own copy of your settings rather than reading from environment variables on every launch.

**On first run**, Ei reads environment variables like `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. to auto-configure providers for you. After that, those values are saved to Ei's local state (`~/.local/share/ei/state.json` by default) and the env vars are no longer consulted.

Detected providers are configured with sensible defaults out of the box:

- **Models**: Only chat-capable models are included — TTS, image generation, embeddings, and other non-chat model families are filtered out. Detection picks a chat model for `conversation_model` (chat responses) and, per provider, usually a cheaper one for `extraction_model` (background extraction/analysis) — for example Anthropic gets Sonnet for chat and Haiku for extraction — rather than presenting a wall of 100+ options; change them later in `/settings`. Only providers Ei has no preference for fall back to one shared starting model.
- **Token limits**: Known models get pre-configured `token_limit` and `max_output_tokens` values based on real-world Ei usage, not just the provider's advertised maximums.
- **Rewrite model**: If Anthropic is detected, its latest Opus is automatically set as your `rewrite_model` (when you haven't set one) — used by `/generate` and `/dedupe`. Other providers don't get an automatic rewrite model; set `rewrite_model` in `/settings`.

All of this only applies on first run. Existing profiles are never modified by detection.

This means:

- **Rotating an API key?** Update it in Ei with `/provider`, not just in your shell.
- **Switching machines?** Your providers and settings travel with your state file (or via Sync), not your shell profile.
- **Changed your mind about a model?** Use `/provider` to set the model for a persona, or `/settings` to change your `conversation_model`/`extraction_model`.
- **Updated sync credentials?** Use `/setsync <user> <pass>` — env vars won't be re-read.

The one exception is `EI_DATA_PATH` (and `EI_SYNC_USERNAME` / `EI_SYNC_PASSPHRASE` for bootstrapping sync on a new machine) — those are always read at startup since Ei needs them before it can load its own state.

# Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EI_DATA_PATH` | `~/.local/share/ei` | Path to Ei's persistent data directory. Set this to keep multiple profiles or point to a shared/synced folder. |
| `XDG_DATA_HOME` | `~/.local/share` | XDG base directory. Ignored if `EI_DATA_PATH` is set. |
| `EI_SYNC_USERNAME` | — | Username for remote sync. If set at startup, bootstraps sync credentials automatically (useful for dotfiles/scripts). |
| `EI_SYNC_PASSPHRASE` | — | Passphrase for remote sync. Paired with `EI_SYNC_USERNAME`. |
| `EI_LOG_LEVEL` | `warn` | Log verbosity written to `tui.log`: `error`, `warn`, `info`, `debug`. |
| `EI_DEBUG_NETWORK_VERBOSE` | — | Set to `1` to dump full LLM request/response payloads as JSON files under `$EI_DATA_PATH/logs/`. One file per call, named `TIMESTAMP_callN_STEP.json`. |

> **Tip**: `tail -f $EI_DATA_PATH/tui.log` to watch live TUI output. Set `EI_LOG_LEVEL=info` to see LLM call summaries (model, latency, token counts). Set `EI_DEBUG_NETWORK_VERBOSE=1` to dump full request/response payloads to `$EI_DATA_PATH/logs/`.


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
