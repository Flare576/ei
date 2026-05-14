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
ei --install                   # Wire Ei into Claude Code, Cursor, and OpenCode (MCP + hooks + persona plugin)
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

This registers Ei with Claude Code, Cursor, and OpenCode — MCP server config, context injection hooks, and (for OpenCode) a persona identity plugin so agents know who they are before the first message:

| Tool | MCP | Context Hook | Persona Plugin |
|------|-----|-------------|----------------|
| **Claude Code** | `~/.claude.json` | `~/.claude/settings.json` (`UserPromptSubmit`) + `~/.claude/hooks/ei-inject.ts` | — |
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` (`beforeSubmitPrompt`) + `~/.cursor/hooks/ei-inject.sh` | — |
| **OpenCode** | manual (see below) | Via Oh My OpenCode compatibility layer (reads `~/.claude/settings.json`) | `~/.config/opencode/plugins/ei-persona.ts` |

**Context hook**: fires before every message, searches Ei for topics relevant to what you just asked, injects them silently. No tool call required.

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

Claude Code and Cursor call `ei mcp` to start the MCP stdio server. You can run it directly to test:

```sh
ei mcp
```

## How Automatic Context Injection Works

After `ei --install`, agents receive Ei context without any manual tool calls:

1. **Before each message** — the hook searches Ei using your prompt + recent conversation history as the query, then injects relevant topics into the conversation as `[Ei Memory Context]`. You won't see this in your chat view; the agent does.
2. **At session start** (OpenCode + OMO only) — the persona plugin finds the agent's Ei persona record and appends it to the system prompt as `<ei-relationship>`. The agent knows its working style, traits, and shared history with you before the session begins.

The `ei_search`, `ei_lookup`, and `ei_fetch_message` MCP tools are still available for targeted mid-session queries — use them when you want to look something up explicitly.

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
