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
people, topics. Use it when the user references past work, mentions how they like things done,
or asks "how did we do X." Query again mid-session when they correct you or reference something
from a previous session.
```

### Claude Code

Add to `~/.claude/CLAUDE.md` (user-level) or `CLAUDE.md` at project root:

```markdown
At session start, use the **ei** MCP to pull user context: call `ei_search` with a
natural-language query about the user's preferences, active projects, and workflow.

Use Ei when the user references past decisions, mentions people or preferences, or asks
"how did we do X." Query again when they correct you or reference something from a previous
session.
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
conversations (facts, people, topics, quotes).

**Use it when:**
- The user refers to past decisions, fixes, or "how we did X" and current chat/codebase
  doesn't have that context.
- You need the user's preferences, contacts, or project conventions (e.g. who to ask for
  access, how something was fixed).
- The question is about the user personally (people, workflow, prior discussions) rather
  than only code.

**How to use:**
1. Call `ei_search` (server `user-ei`) with a natural-language query; optionally filter by
   `type`: facts, people, topics, quotes.
2. If you need full detail for a result, call `ei_lookup` with the entity `id` from step 1.

Prefer querying Ei before asking the user for context they may have already shared.
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
