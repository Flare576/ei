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
ei --install                   # Register Ei with OpenCode, Claude Code, and Cursor
ei mcp                         # Start the Ei MCP stdio server (for Cursor/Claude Desktop)
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
```

Quotes surfaced by `ei_search` or `ei_find_memory` include a `message_id` field in this format — pipe it to `ei --id` to read the original conversation.

# OpenCode Integration

## Quick Install

```sh
ei --install
```

This registers Ei with Claude Code and Cursor via MCP:

- **Claude Code**: writes `~/.claude.json` with an MCP server entry
- **Cursor**: writes `~/.cursor/mcp.json` with an MCP server entry

**OpenCode**: add the MCP server manually to `~/.config/opencode/opencode.jsonc`:

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

Claude Code and Cursor call `ei mcp` to start the MCP stdio server. You can run it directly to test:

```sh
ei mcp
```

## Activating Ei in Your Agent

`ei --install` handles the technical wiring. This step tells your agent *when* and *how* to reach for it.

Without this, your agent has Ei available but may never call it. Add a snippet to your tool's config and it'll start querying Ei at the start of each session — and whenever you reference past context.

### OpenCode

Add to `~/.config/opencode/AGENTS.md` (applies to all projects):

```markdown
At session start, query Ei for user context:

\```bash
ei "What are the user's current preferences, active projects, and workflow?"
\```

Ei is a persistent knowledge base built from the user's conversations — facts, preferences,
people, topics, personas. Use it when the user references past work, mentions how they like things done,
asks "how did we do X," or needs to look up a person by any name, handle, or account (GitHub username,
Discord handle, email, nickname, etc.) — people results include an `identifiers` array covering all
known accounts and aliases for that person. Use `ei --persona "Beta" "walruses"` to scope results to
what a specific persona has learned. Use `ei personas "name"` to find personas by name. Query again
mid-session when they correct you or reference something from a previous session.
```

### Claude Code

Add to `~/.claude/CLAUDE.md` (user-level) or `CLAUDE.md` at project root:

```markdown
At session start, use the **ei** MCP to pull user context: call `ei_search` with a
natural-language query about the user's preferences, active projects, and workflow.
A `persona` filter is available to scope results to what a specific persona has learned.
Use `type: "personas"` to search for personas by name.

Use Ei when the user references past decisions, mentions people or preferences, asks
"how did we do X," or needs to look up a person by any name, handle, or account — people
results include an `identifiers` array (GitHub username, Discord handle, email, nickname, etc.)
covering all known accounts and aliases. Query again when they correct you or reference
something from a previous session.
```

### Cursor

Create `.cursor/rules/ei-mcp.mdc` in your project (or `~/.cursor/rules/` for user-level):

```markdown
---
description: When to use the Ei MCP for user memory and context
alwaysApply: true
---
# Ei MCP — User knowledge base

The **ei** MCP (server `user-ei`) is a persistent knowledge base built from the user's
conversations (facts, people, topics, quotes, personas).

**Use it when:**
- The user refers to past decisions, fixes, or "how we did X" and current chat/codebase
  doesn't have that context.
- You need the user's preferences, contacts, or project conventions (e.g. who to ask for
  access, how something was fixed).
- You need to look up a person by any name, handle, or account — people results include an
  `identifiers` array (GitHub username, Discord handle, email, nickname, etc.) covering all
  known accounts and aliases for that person.
- The question is about the user personally (people, workflow, prior discussions) rather
  than only code.

**How to use:**
1. Call `ei_search` (server `user-ei`) with a natural-language query (or omit query and use `recent: true` to browse); optionally filter by `type` (facts, people, topics, quotes, personas) or `persona` display_name.
2. If you need full detail for a human entity (fact, topic, person, quote), call `ei_fetch_memory` with the entity `id`.
3. If you need full detail for a result including personas, call `ei_lookup` with the entity `id` from step 1.
4. To fetch a specific message with surrounding context, call `ei_fetch_message` with the message `id` and optional `before`/`after` counts.

Prefer querying Ei before asking the user for context they may have already shared.
```

## MCP Tools Reference

The MCP server exposes these tools to Claude Code, Cursor, and OpenCode:

| Tool | Description |
|------|-------------|
| `ei_search` | Balanced search across all five data types (facts, topics, people, quotes, personas). Supports `type`, `persona`, `source`, `recent`, `limit` filters. |
| `ei_lookup` | Full-record lookup for any entity by ID (facts, topics, people, quotes, personas). |
| `ei_find_memory` | Grouped human-data search — facts, topics, people, quotes. Returns results grouped by type. Mirrors the persona `find_memory` tool interface. |
| `ei_fetch_memory` | Full-record lookup for a human entity (Fact, Topic, Person, or Quote) by ID. Returns the complete record including all fields. |
| `ei_fetch_message` | Retrieve a specific message by fully-qualified ID with optional `before`/`after` context window. Routes to the correct source: `ei:uuid` searches Ei state, `opencode:machine:session:id` queries the OpenCode SQLite DB, `claudecode:...` scans Claude Code JSONL files, `cursor:...` reads the Cursor global DB. Returns message content, surrounding context, and session metadata. |

### `ei_search` / `ei_find_memory` arguments

| Arg | Type | Description |
|-----|------|-------------|
| `query` | string (optional) | Search text. Omit to browse by recency. |
| `persona` | string (optional) | Persona display_name to scope results to what that persona has learned |
| `type` | enum (optional, `ei_search` only) | `facts` \| `people` \| `topics` \| `quotes` \| `personas` — omit for balanced results |
| `types` | array (optional, `ei_find_memory` only) | `["facts", "topics", "people", "quotes"]` — omit for all human types |
| `limit` | number (optional) | Max results, default 10 |
| `recent` | boolean (optional) | Sort by most recently mentioned instead of relevance |

## Output Shapes

All search commands return arrays. Each result includes a `type` field.

**Fact / Topic**: `{ type, id, name, description, sentiment, ...type-specific fields }`

**Person**: `{ type, id, name, description, relationship, sentiment, identifiers[] }` — `identifiers` contains all known accounts and aliases (e.g. `{ type: "GitHub", value: "flare576" }`)

**Quote**: `{ type, id, text, speaker, timestamp, linked_items[] }`

**Persona**: `{ type, id, display_name, short_description, model, base_prompt, traits[], topics[] }`

**ID lookup** (`lookup: true`): single object (not an array) with the same shape.
