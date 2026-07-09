# The CLI

> For installation, see the [TUI README](../../tui/README.md#installation).
```sh
ei                             # Start the TUI
ei "query string"              # Return up to 10 results across all types
ei -n 5 "query string"         # Return up to 5 results
ei facts -n 5 "query string"      # Return up to 5 facts
ei people -n 5 "query string"     # Return up to 5 people
ei topics -n 5 "query string"     # Return up to 5 topics
ei quotes -n 5 "query string"     # Return up to 5 quotes
ei personas -n 5 "query string"   # Return up to 5 personas (name match)
ei --persona "Beta" "query string"    # Filter results to what Beta has learned
ei --recent                            # Most recently mentioned items (no query needed)
ei --persona "Beta" --recent           # Most recently mentioned items Beta has learned
ei --id <id>                   # Look up entity by ID — or fetch a message by FQ ID
echo <id> | ei --id            # Look up entity by ID from stdin
ei --install                   # Wire Ei into Claude Code, Cursor, Codex, and OpenCode (skills + context hooks + persona plugin where supported; MCP is removed by default on Claude Code/Cursor/Codex — see "MCP Server" below)
ei --sync                      # Pull latest state from remote sync server into state.backup.json (no TUI required)
ei mcp                         # Start the Ei MCP stdio server (for Claude Code/Cursor/Codex)
ei create <type> --json '<json>'       # Create a new entity (fact/topic/person/persona)
ei update <type> <id> --json '<json>'  # Replace an entity by ID (fact/topic/person/quote/persona)
ei remove <type> <id>                  # Remove an entity by ID
```

Type aliases: `fact`, `person`, `topic`, `quote`, `persona` all work (singular or plural).

# An Agentic Tool

The `--id` flag is designed for piping. For example, search for a topic and then fetch the full entity:

```sh
ei "memory leak" | jq '.[0].id' | ei --id
```

It also resolves fully-qualified message IDs from any supported integration, returning the original message content and session context:

```sh
ei --id "opencode:jeremys-macbook-pro:ses_38a7...:msg_c75b..."
ei --id "claudecode:my-machine:session-uuid:message-uuid"
ei --id "cursor:my-machine:composer-uuid:bubble-uuid"
ei --id "codex:my-machine:thread-uuid:evt_42"
ei --id "pi:my-machine:session-uuid:session-uuid/entry-id"
```

Quotes surfaced by `ei_search` include a `message_id` field in this format — pipe it to `ei --id` to read the original conversation.

# OpenCode Integration

## Quick Install

```sh
ei --install
```

This registers Ei with Claude Code, Cursor, Codex, and OpenCode — skill directories, context injection hooks where supported, and (for OpenCode) a persona identity plugin so agents know who they are before the first message. **MCP is removed by default** on Claude Code, Cursor, and Codex (see [MCP Server](#mcp-server) below) — every capability those MCP tools offered has a skill or CLI equivalent, so there's no longer a persistent `ei mcp` process sitting around per open session:

| Tool | Skills | Context Hook | Persona Plugin |
|------|--------|-------------|----------------|
| **Claude Code** | `~/.claude/skills/` + shared `~/.agents/skills/` | `~/.claude/settings.json` (`UserPromptSubmit`) + `~/.claude/hooks/ei-inject.ts` | — |
| **Cursor** | shared `~/.agents/skills/` (Cursor's own native discovery path) | `~/.cursor/hooks.json` (`beforeSubmitPrompt`) + `~/.cursor/hooks/ei-inject.sh` | — |
| **Codex** | shared `~/.agents/skills/` (Codex's own native discovery path) | `~/.codex/hooks.json` (`UserPromptSubmit`) + `~/.codex/hooks/ei-inject.ts` | Local Codex agent plugin if installed separately |
| **OpenCode** | `~/.config/opencode/skills/` | Via Oh My OpenCode compatibility layer (reads `~/.claude/settings.json`) | `~/.config/opencode/plugins/ei-persona.ts` |
| **Pi** | shared `~/.agents/skills/` (Pi's own native discovery path) | `~/.pi/agent/extensions/ei-integration.ts` | — |
| **OMP** | `~/.omp/agent/skills/` | `~/.omp/agent/extensions/ei-integration.ts` | — |

**Context hook**: fires before every message, searches Ei for relevant memory, and injects it silently. No tool call required.

**Persona plugin** (OpenCode + [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode) only): injects the agent's Ei relationship record directly into the system prompt at session start — traits, working style, shared context. The agent knows who it is *to you* before it reads a word of your message.

**OpenCode MCP**: add manually to `~/.config/opencode/opencode.jsonc`:

```json
{
  "mcp": {
    "ei": {
      "type": "local",
      "command": ["bunx", "ei-tui", "mcp"],
      "enabled": true,
      "environment": {
        "EI_DATA_PATH": "/path/to/your/ei/data"
      }
    }
  }
}
```

Restart your agent tool after changes to activate.

### MCP Server

`ei --install` removes any Ei MCP registration from Claude Code, Cursor, and Codex by default — every MCP tool (`ei_search`, `ei_lookup`, `ei_fetch_message`, `ei_create`, `ei_update`, `ei_remove`) is a thin wrapper over the same CLI/corrections-queue code the `ei-search`, `ei-curate`, and `ei-persona` skills already teach agents to call directly. A persistent `ei mcp` process per open session bought nothing — it reloads state from disk fresh on every call, same as the CLI — and multiple such processes are what caused real Ei MCP processes to get mistaken for orphaned processes and killed.

MCP support isn't removed from the codebase — `ei mcp` still works if you want it back:

```sh
ei mcp   # Start the Ei MCP stdio server directly, for testing or manual wiring
```

To re-register it manually:

- **Codex**: `codex mcp add ei --env EI_DATA_PATH=<path> -- bunx ei-tui mcp`
- **Claude Code**: add to `~/.claude.json`'s `mcpServers`:
  ```json
  { "ei": { "type": "stdio", "command": "bunx", "args": ["ei-tui", "mcp"], "env": { "EI_DATA_PATH": "${EI_DATA_PATH}" } } }
  ```
- **Cursor**: add to `~/.cursor/mcp.json`'s `mcpServers` (same shape, but Cursor doesn't support `${VAR}` substitution — use a literal path for `EI_DATA_PATH`)

## How Automatic Context Injection Works

After `ei --install`, agents receive Ei context without any manual tool calls:

1. **Before each message** — the hook searches Ei using your prompt + recent conversation history as the query, then injects relevant topics into the conversation as `[Ei Memory Context]`. You won't see this in your chat view; the agent does.
2. **At session start** (OpenCode + OMO only) — the persona plugin finds the agent's Ei persona record and appends it to the system prompt as `<ei-relationship>`. The agent knows its working style, traits, and shared history with you before the session begins.

For targeted, explicit mid-session queries — beyond whatever the hook already silently injected — agents reach for the `ei-search` skill (installed by default) to run `ei "query"` / `ei --id <id>` directly. The `ei_search`, `ei_lookup`, and `ei_fetch_message` MCP tools cover the same ground and remain available if you've manually re-registered MCP (see above).

## MCP Tools Reference

The MCP server exposes these tools to Claude Code, Cursor, Codex, and OpenCode:

| Tool | Description |
|------|-------------|
| `ei_search` | Search across all five data types (facts, topics, people, quotes, personas). Supports `type`, `persona`, `source`, `recent`, `limit` filters. Start here. |
| `ei_lookup` | Full-record lookup for any entity by ID — facts, topics, people, quotes, or personas. Use when you need complete details beyond the search summary. |
| `ei_fetch_message` | Retrieve a specific message by fully-qualified ID with optional `before`/`after` context window. Use when a quote result has a `message_id` and you want the original conversation. Routes to the correct source automatically. |
| `ei_create` | Create a new entity (fact, topic, person, or persona). Pass a full JSON record matching the entity's schema. Validates server-side; unknown fields are rejected. Returns the assigned id and the full stored record. Not available for quotes — verifiable-origin data can only be corrected via `ei_update`, never created. |
| `ei_update` | Replace an entity by ID. Full-record replacement — fetch first with `ei_lookup`, edit the fields you need to change, and pass the complete record back. Any omitted field is treated as absent, not "leave unchanged". Supports fact, topic, person, quote, and persona. |
| `ei_remove` | Permanently remove a fact, topic, person, or persona by ID. Use to drop bad extracted data that shouldn't be corrected, just deleted, or to delete a persona that's no longer needed. Not available for quotes. Reserved built-in personas ("ei", "emmet") can't be removed this way — use `ei_update` to set `is_archived: true` instead. |

### `ei_search` arguments

| Arg | Type | Description |
|-----|------|-------------|
| `query` | string (optional) | Search text. Omit to browse by recency. |
| `type` | enum (optional) | `facts` \| `people` \| `topics` \| `quotes` \| `personas` — omit for balanced results across all types |
| `persona` | string (optional) | Persona display_name to scope results to what that persona has learned |
| `source` | string (optional) | Prefix match against source identifiers (e.g. `opencode`, `cursor:my-machine`, `codex:my-machine`) |
| `limit` | number (optional) | Max results, default 10 |
| `recent` | boolean (optional) | Sort by most recently mentioned instead of relevance |

## Output Shapes

All search commands return arrays. Each result includes a `type` field.

**Fact / Topic**: `{ type, id, name, description, sentiment, ...type-specific fields }`

**Person**: `{ type, id, name, description, relationship, sentiment, identifiers[] }` — `identifiers` contains all known accounts and aliases (e.g. `{ type: "GitHub", value: "flare576" }`)

**Quote**: `{ type, text, speaker, message_id, timestamp, linked_items[] }` — note: `id` is intentionally omitted; use `message_id` with `ei_fetch_message` to retrieve the original conversation

**Persona**: `{ type, id, display_name, short_description, model, base_prompt, traits[], topics[] }`

**ID lookup** (`ei --id <id>` / `ei_lookup`): single object (not an array) with the same shape as above, plus a `linked_quotes` array for Fact, Topic, and Person records — quotes attributed to that entity, useful when auditing what was said about a person or topic. Persona ID lookups additionally get a `tools` field: the raw `tools` id array is replaced with a self-documenting `{ providerDisplayName: { toolDisplayName: boolean } }` map, so an agent can see exactly what's granted (and what else is grantable) without a separate lookup.

## Memory Management

`ei create`, `ei update`, and `ei remove` let you correct Ei's knowledge base directly — from the CLI or via MCP tools in your coding agent.

### Which types support which operations

| Type | create | update | remove |
|------|--------|--------|--------|
| fact | yes | yes | yes |
| topic | yes | yes | yes |
| person | yes | yes | yes |
| quote | — | yes | — |
| persona | yes | yes | yes |

Quotes are created only by Ei's extraction pipeline (verifiable-origin data). They can be updated to repoint `data_item_ids` after a split/merge or to fix mistranscribed text, but never created or removed via these commands.

Personas support all three operations too, but through a separate schema (`PersonaEntity`, not the fact/topic/person `DataItemBase` shape) — see the `ei create/update/remove persona` examples below and the `ei-persona` skill for guided authoring.

### Update semantics: full replacement, not a patch

`ei update` replaces the entire record. Any field you omit is gone. The safe pattern:

```sh
# 1. Fetch the current record
ei --id abc-123

# 2. Edit only the fields you want to change, then submit the whole thing
ei update fact abc-123 --json '{"name":"Field of Study","description":"Software Engineering / CS","sentiment":0,"validated_date":"2026-03-16T22:46:03.367Z"}'
```

### Examples (from `ei --help`)

```sh
ei create fact --json '{"name":"Field of Study","description":"CS","sentiment":0,"validated_date":""}'
ei update fact abc-123 --json '{"name":"Field of Study","description":"Updated","sentiment":0,"validated_date":""}'
ei update quote <id> --json '{"data_item_ids":["person-b-id"], ...}'  # Repoint a quote after splitting a bad merge (fetch the full record via 'ei --id <id>' first)
ei create persona --json '{"display_name":"Yoda","long_description":"Speaks in inverted syntax, wise and patient.","traits":[{"name":"Inverted speech","description":"Talks like Yoda","sentiment":0.7}],"topics":[]}'
ei update persona <id> --json '<full persona record from ei --id <id>, edited>'
ei remove persona abc-123              # Remove a persona (reserved personas like "ei"/"emmet" must be archived instead)
ei remove fact abc-123
```

### Corrections queue

Changes written by `ei create/update/remove` (and the MCP tools `ei_create/ei_update/ei_remove`) go through a corrections queue (`$EI_DATA_PATH/corrections.json`). If a live Ei instance (TUI or daemon) is running, the Processor drains this file on every runLoop tick and applies changes to the live StateManager — no TUI restart required. If nothing is running, the write applies straight to `state.json` instead of waiting for a TUI session that may not start for days.

For safe, agent-driven curation with verification guardrails, use the `ei-curate` skill (see [Shipped Skills](#shipped-skills) below).

## Quick Sync

Sometimes you want your latest Ei profile available on a machine without running the full TUI — especially if the TUI is already running on another machine.

```sh
ei --sync
```

Pulls the latest state from your remote sync server and saves it to `state.backup.json`. Works the same credential hierarchy as the TUI: reads from `state.backup.json` first, falls back to `EI_SYNC_USERNAME` / `EI_SYNC_PASSPHRASE` environment variables if not present.

Will abort (with a clear error) if `state.json` already exists on this machine — that means Ei has run here and a conflict resolution step would be needed on next launch.

## Shipped Skills

`ei --install` copies Ei's shipped skills into each harness's skill discovery directory alongside context hooks:

- **Claude Code**: `~/.claude/skills/<skill-name>/`
- **OMP**: `~/.omp/agent/skills/<skill-name>/`
- **OpenCode**: `~/.config/opencode/skills/<skill-name>/`
- **Cursor, Codex, Pi (base)**: shared `~/.agents/skills/<skill-name>/` — written unconditionally, once, regardless of which of these three are actually detected on the machine, since all three natively discover this cross-tool convention on their own

Skills are installed automatically — any directory added under `skills/` in the Ei package gets copied to every location above on the next `ei --install` run.

### Currently shipped

| Skill | What it does |
|-------|-------------|
| `ei-search` | Deliberate, explicit read-path lookups — search, full-record fetch, original-message fetch — via the CLI (`ei "query"`, `ei --id <id>`), for the mid-conversation case beyond whatever the automatic context-injection hook already surfaced. Read-only. Read the full workflow at `skills/ei-search/SKILL.md`. |
| `ei-curate` | Safe agent-driven memory curation. Provides verified workflows for fixing merged records, bad attributions, stale facts, and mis-attributed quotes — using `ei create/update/remove` with explicit confirmation before every write. Read the full workflow at `skills/ei-curate/SKILL.md`. Load it in your harness with `/ei-curate`. |
| `ei-persona` | Safe agent-driven persona authoring. Guides creating, editing (traits/topics/description), archiving, or deleting a persona's *character* via `ei create/update/remove persona` — distinct from `ei-curate`, which corrects learned data rather than authoring identity. Read the full workflow at `skills/ei-persona/SKILL.md`. Load it in your harness with `/ei-persona`. |
