# The CLI

> For installation, see the [TUI README](../../tui/README.md#installation).
```sh
ei                             # Start the TUI
ei "query string"              # Return up to 10 results across all types
ei -n 5 "query string"         # Return up to 5 results
ei facts -n 5 "query string"   # Return up to 5 facts
ei traits -n 5 "query string"  # Return up to 5 traits
ei people -n 5 "query string"  # Return up to 5 people
ei topics -n 5 "query string"  # Return up to 5 topics
ei quotes -n 5 "query string"  # Return up to 5 quotes
ei --id <id>                   # Look up a specific entity by ID
echo <id> | ei --id            # Look up entity by ID from stdin
ei --install                   # Install the Ei tool for OpenCode
```

Type aliases: `fact`, `trait`, `person`, `topic`, `quote` all work (singular or plural).

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

This writes `~/.config/opencode/tools/ei.ts` with a complete tool definition. Restart OpenCode to activate.

## What the Tool Provides

The installed tool gives OpenCode agents access to all five data types with proper Zod-validated args:

| Arg | Type | Description |
|-----|------|-------------|
| `query` | string (required) | Search text, or entity ID when `lookup=true` |
| `type` | enum (optional) | `facts` \| `traits` \| `people` \| `topics` \| `quotes` — omit for balanced results |
| `limit` | number (optional) | Max results, default 10 |
| `lookup` | boolean (optional) | If true, fetch single entity by ID |

## Output Shapes

All search commands return arrays. Each result includes a `type` field.

**Fact / Trait / Person / Topic**: `{ type, id, name, description, sentiment, ...type-specific fields }`

**Quote**: `{ type, id, text, speaker, timestamp, linked_items[] }`

**ID lookup** (`lookup: true`): single object (not an array) with the same shape.
