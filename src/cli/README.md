# The CLI

> For installation, see the [TUI README](../../tui/README.md#installation).
```sh
ei                             # Start the TUI
ei "query string"              # Return up to 10 results across facts/people/topics/quotes (no personas — use "ei personas")
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
ei --identifier <type> <value>  # Look up a person by identifier type + value (case-insensitive type, exact value), e.g. --identifier "GitHub" "flare576"
ei --install                   # Wire Ei into Claude Code, Cursor, Codex, and OpenCode (skills + context hooks + persona plugin where supported; MCP is removed by default on Claude Code/Cursor/Codex — see "MCP Server" below)
ei --sync                      # Pull latest state from remote sync server into state.backup.json (no TUI required)
ei mcp                         # Start the Ei MCP stdio server (for Claude Code/Cursor/Codex)
ei create <type> --json '<json>'       # Create a new entity (fact/topic/person/persona)
ei update <type> <id> --json '<json>'  # Replace an entity by ID (fact/topic/person/quote/persona)
ei remove <type> <id>                  # Remove an entity by ID
```

Type aliases: `fact`, `person`, `topic`, `quote`, `persona` all work (singular or plural).

`--identifier` matches the *first* person whose identifier array contains that value — safe for identifier types that are unique by construction (e.g. `Ei Persona`, whose value is the linked persona's id — a UUID for user-created personas, but the literal strings `ei`/`emmet` for the two reserved ones), but arbitrary if two people happen to share a value under a type that isn't guaranteed unique (e.g. duplicate `Nickname` or `First Name` entries).

# An Agentic Tool

The `--id` flag is designed for piping. Entity hits (fact/person/topic/persona) carry an `id`; quote hits don't (they carry `message_id` instead) — so a safe drill-down handles both:

```sh
ei "memory leak" | jq -r '.[0] | if .id != null then .id else .message_id end' | ei --id
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
2. **At session start** (OMP, and OpenCode with or without Oh My OpenCode) — the persona extension/plugin finds the agent's Ei persona record and appends it to the system prompt as `<ei-relationship>`. The block carries the persona's base prompt, its strongest traits as **Working Style**, its topics as **Shared Context**, and — when a Person record is linked to the persona — an **Ei Person Log** notice giving that log's current character count, plus a nudge to ask you for a reflection once the count passes 3,000. The agent knows its working style, traits, and shared history with you before the session begins. **Claude Code, Cursor, Codex, and base Pi do not receive this block** — their session hooks inject memory search results only. That gap is open, tracked as [issue #94](https://github.com/Flare576/ei/issues/94).

For targeted, explicit mid-session queries — beyond whatever the hook already silently injected — agents reach for the `ei-search` skill (installed by default) to run `ei "query"` / `ei --id <id>` directly. The `ei_search`, `ei_lookup`, and `ei_fetch_message` MCP tools cover the same ground and remain available if you've manually re-registered MCP (see above).

## MCP Tools Reference

The MCP server exposes these tools to Claude Code, Cursor, Codex, and OpenCode:

| Tool | Description |
|------|-------------|
| `ei_search` | Balanced search across facts, topics, people, and quotes (personas excluded — pass `type: "personas"` explicitly to search those). Supports `type`, `persona`, `source`, `recent`, `limit` filters. Start here. |
| `ei_lookup` | Full-record lookup for any entity by ID — facts, topics, people, quotes, or personas. Use when you need complete details beyond the search summary. |
| `ei_fetch_message` | Retrieve a specific message by fully-qualified ID with optional `before`/`after` context window. Use when a quote result has a `message_id` and you want the original conversation. Routes to the correct source automatically. |
| `ei_create` | Create a new entity (fact, topic, person, or persona). Pass a full JSON record matching the entity's schema. Validates server-side; unknown fields are rejected. Returns the assigned id and the full stored record. Not available for quotes — verifiable-origin data can only be corrected via `ei_update`, never created. |
| `ei_update` | Replace an entity by ID. Full-record replacement — fetch first with `ei_lookup`, edit the fields you need to change, and pass the complete record back. Any omitted field is treated as absent, not "leave unchanged". Supports fact, topic, person, quote, and persona. |
| `ei_remove` | Permanently remove a fact, topic, person, or persona by ID. Use to drop bad extracted data that shouldn't be corrected, just deleted, or to delete a persona that's no longer needed. Not available for quotes. Reserved built-in personas ("ei", "emmet") can't be removed this way — use `ei_update` to set `is_archived: true` instead. |

### `ei_search` arguments

| Arg | Type | Description |
|-----|------|-------------|
| `query` | string (optional) | Search text. Omit to browse by recency. |
| `type` | enum (optional) | `facts` \| `people` \| `topics` \| `quotes` \| `personas` — omit for balanced results across facts/people/topics/quotes; pass `personas` explicitly to search those |
| `persona` | string (optional) | Persona display_name to scope results to what that persona has learned |
| `source` | string (optional) | Prefix match against source identifiers (e.g. `opencode`, `cursor:my-machine`, `codex:my-machine`) |
| `limit` | number (optional) | Max results, default 10 |
| `recent` | boolean (optional) | Sort by most recently mentioned instead of relevance |

## Output Shapes

All search commands return arrays. Each result includes a `type` field.

**Fact / Topic**: `{ type, id, name, description, sentiment, ...type-specific fields }`

**Person**: `{ type, id, name, description, relationship, sentiment, identifiers[] }` — `identifiers` contains all known accounts and aliases (e.g. `{ type: "GitHub", value: "flare576" }`)

**Quote**: `{ type, id, text, speaker, message_id, timestamp, linked_items[] }` — `message_id` links to `ei_fetch_message` for the original conversation; `id` is the stable identity for `ei update quote`

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

One persona-only field worth flagging for external callers: `external_reflection_only` (default `false`, alongside `is_paused`/`is_archived`) skips Ei's automatic Reflection critic for that persona so an external, agent-driven reflection can run first instead — it applies uniformly to every persona, reserved ones (`ei`/`emmet`) included.

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
| `ei-reflect` | Manual self-reflection for a coding-harness agent over its own accumulated Person log, for when the log fills faster than Ei's automatic Reflection critic can usefully consume it. Not a single file: a root dispatcher (`skills/ei-reflect/SKILL.md`) over two lenses in `skills/ei-reflect/lenses/`. The **Persona** lens (`lenses/persona.md`) is the identity half — it reviews the log against the current persona identity via the CLI (`ei personas`, `ei --id`) and rewrites traits/topics/descriptions with `ei update persona`. The **Agent** lens (`lenses/agent.md`) is the operating-contract half — the rules, sequences, and tool preferences that govern how the agent works *in this harness* — which it writes into the harness's own instruction files as a marked delimited region, touching no Ei record. The dispatcher resolves the persona, reads the log once, splits the evidence between the lenses, and clears the log with `ei update person` only once both lenses reach a terminal state — never while the Agent lens is still waiting on the user to choose a write target. `skills/ei-reflect/references/` holds the CLI surface, per-harness target files, and the configuration surfaces no file-based tool can reach. Read the full workflow at `skills/ei-reflect/SKILL.md`. Load it in your harness with `/ei-reflect`. |
| `ei-rewrite` | Manual, on-demand slimming of a bloated Topic or Person record — redistributes correctly-attributed content that's outgrown the record's contract (a Person profile accreting project detail, a Topic becoming a catch-all) into the right existing or new records, with mandatory Ei-native recon before creating anything. Mirrors the automatic Rewrite ceremony (`src/core/handlers/rewrite.ts`) by hand. Distinct from `ei-curate`, which fixes *wrong* data rather than *misplaced* data. Read the full workflow at `skills/ei-rewrite/SKILL.md`. Load it in your harness with `/ei-rewrite`. |
| `ei-generate` | Agent-driven document synthesis from Ei's memory — a runbook, onboarding doc, status brief, or profile writeup, produced by the coding agent itself (not Ei's queued `/generate` feature) from CLI-only recon (facet search, multi-phrasing, `linked_quotes` graph-walk, self-filtering) plus a risk-triggered gate that asks about names/handles and audience before drafting anything involving a third party. Read-only against Ei; the output file is untracked and placed wherever the user and agent agree. Read the full workflow at `skills/ei-generate/SKILL.md`. Load it in your harness with `/ei-generate`. |
