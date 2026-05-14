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

Quotes surfaced by `ei_search` include a `message_id` field in this format — pipe it to `ei --id` to read the original conversation.

# OpenCode Integration

## Quick Install

```sh
ei --install
```

This registers Ei with Claude Code, Cursor, and OpenCode — MCP server config **and** context injection hooks so agents get Ei memory automatically without needing to call a tool:

| Tool | MCP | Context Hook |
|------|-----|-------------|
| **Claude Code** | `~/.claude.json` | `~/.claude/settings.json` (`UserPromptSubmit`) + `~/.claude/hooks/ei-inject.ts` |
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` (`beforeSubmitPrompt`) + `~/.cursor/hooks/ei-inject.sh` |
| **OpenCode** | manual (see below) | Detected automatically via Oh My OpenCode compatibility layer (reads `~/.claude/settings.json`) |

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

Claude Code and Cursor call `ei mcp` to start the MCP stdio server. You can run it directly to test:

```sh
ei mcp
```

## Activating Ei in Your Agent

`ei --install` handles both the technical wiring **and** context injection. After running it, your agent will automatically receive recent Ei memory before every message — no tool calls required.

The snippets below are optional manual overrides if you want to customize the behavior or add targeted mid-session queries.

### OpenCode

If you're using [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode), the `UserPromptSubmit` hook installed by `ei --install` is picked up automatically via its Claude Code compatibility layer — no additional config needed.

If you're running vanilla OpenCode without Oh My OpenCode, add to `~/.config/opencode/AGENTS.md`:

```markdown
Use the **ei** MCP to pull user context when the user references past work, mentions people
or preferences, or asks "how did we do X." Call `ei_search` with a natural-language query.
Use `ei --persona "Beta" "topic"` to scope results to what a specific persona has learned.
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
2. If you need the full record for any result, call `ei_lookup` with the entity `id` from step 1 — works for all types including personas.
3. If a quote result has a `message_id`, call `ei_fetch_message` with that ID and optional `before`/`after` counts to read the original conversation with context.

Prefer querying Ei before asking the user for context they may have already shared.
```

## MCP Tools Reference

The MCP server exposes these tools to Claude Code, Cursor, and OpenCode:

| Tool | Description |
|------|-------------|
| `ei_search` | Search across all five data types (facts, topics, people, quotes, personas). Supports `type`, `persona`, `source`, `recent`, `limit` filters. Start here. |
| `ei_lookup` | Full-record lookup for any entity by ID — facts, topics, people, quotes, or personas. Use when you need complete details beyond the search summary. |
| `ei_fetch_message` | Retrieve a specific message by fully-qualified ID with optional `before`/`after` context window. Use when a quote result has a `message_id` and you want the original conversation. Routes to the correct source automatically. |

### `ei_search` arguments

| Arg | Type | Description |
|-----|------|-------------|
| `query` | string (optional) | Search text. Omit to browse by recency. |
| `type` | enum (optional) | `facts` \| `people` \| `topics` \| `quotes` \| `personas` — omit for balanced results across all types |
| `persona` | string (optional) | Persona display_name to scope results to what that persona has learned |
| `source` | string (optional) | Prefix match against source identifiers (e.g. `opencode`, `cursor:my-machine`) |
| `limit` | number (optional) | Max results, default 10 |
| `recent` | boolean (optional) | Sort by most recently mentioned instead of relevance |

## Output Shapes

All search commands return arrays. Each result includes a `type` field.

**Fact / Topic**: `{ type, id, name, description, sentiment, ...type-specific fields }`

**Person**: `{ type, id, name, description, relationship, sentiment, identifiers[] }` — `identifiers` contains all known accounts and aliases (e.g. `{ type: "GitHub", value: "flare576" }`)

**Quote**: `{ type, text, speaker, message_id, timestamp, linked_items[] }` — note: `id` is intentionally omitted; use `message_id` with `ei_fetch_message` to retrieve the original conversation

**Persona**: `{ type, id, display_name, short_description, model, base_prompt, traits[], topics[] }`

**ID lookup** (`lookup: true`): single object (not an array) with the same shape.
