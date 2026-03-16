# The CLI

> For installation, see the [TUI README](../../tui/README.md#installation).
```sh
ei                             # Start the TUI
ei "query string"              # Return up to 10 results across all types
ei -n 5 "query string"         # Return up to 5 results
ei facts -n 5 "query string"   # Return up to 5 facts
ei people -n 5 "query string"  # Return up to 5 people
ei topics -n 5 "query string"  # Return up to 5 topics
ei quotes -n 5 "query string"  # Return up to 5 quotes
ei --id <id>                   # Look up a specific entity by ID
echo <id> | ei --id            # Look up entity by ID from stdin
ei --install                   # Register Ei with OpenCode, Claude Code, and Cursor
ei mcp                         # Start the Ei MCP stdio server (for Cursor/Claude Desktop)
```

Type aliases: `fact`, `person`, `topic`, `quote` all work (singular or plural).

# An Agentic Tool

The `--id` flag is designed for piping. For example, search for a topic and then fetch the full entity:

```sh
ei "memory leak" | jq '.[0].id' | ei --id
```

# OpenCode Integration

## Quick Install

```sh
ei --install
```

This registers Ei with every supported agent environment it detects:

- **OpenCode**: writes `~/.config/opencode/tools/ei.ts`
- **Claude Code**: runs `claude mcp add` (or writes `~/.claude.json` as fallback)
- **Cursor**: writes `~/.cursor/mcp.json`

Restart your agent tool after running to activate.

### MCP Server

Claude Code and Cursor call `ei mcp` to start the MCP stdio server. You can run it directly to test:

```sh
ei mcp
```

## What the Tool Provides

The installed tool gives OpenCode agents access to all four data types with proper Zod-validated args:

| Arg | Type | Description |
|-----|------|-------------|
| `query` | string (required) | Search text, or entity ID when `lookup=true` |
| `type` | enum (optional) | `facts` \| `people` \| `topics` \| `quotes` — omit for balanced results |
| `limit` | number (optional) | Max results, default 10 |
| `lookup` | boolean (optional) | If true, fetch single entity by ID |

## Output Shapes

All search commands return arrays. Each result includes a `type` field.

**Fact / Person / Topic**: `{ type, id, name, description, sentiment, ...type-specific fields }`

**Quote**: `{ type, id, text, speaker, timestamp, linked_items[] }`

**ID lookup** (`lookup: true`): single object (not an array) with the same shape.
