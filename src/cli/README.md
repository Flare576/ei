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
ei --install                   # Wire Ei into Claude Code, Codex, Cursor, OpenCode, Pi, and OMP (skills + per-prompt memory hook + per-session identity hook; MCP is removed by default on Claude Code/Cursor/Codex — see "MCP Server" below)
ei --sync                      # Pull latest state from remote sync server into state.backup.json (no TUI required)
ei mcp                         # Start the Ei MCP stdio server (for Claude Code/Cursor/Codex)
ei create <type> --json '<json>' | --json-file <path>       # Create a new entity (fact/topic/person/persona)
ei update <type> <id> --json '<json>' | --json-file <path>  # Update an entity by ID (merge patch for topic/person/persona; full record for fact — never quote)
ei remove <type> <id>                  # Remove an entity by ID (fact/topic/person/quote/persona)
ei create quote | fix quote | relink quote | remove quote   # Quote writes have their own verbs — `ei update` on a quote always rejects (see "Quote commands")
```

Type aliases: `fact`, `person`, `topic`, `quote`, `persona` all work (singular or plural).

`--identifier` matches the *first* person whose identifier array contains that value — safe for identifier types that are unique by construction (e.g. `Ei Persona`, whose value is the linked persona's id — a UUID for user-created personas, but the literal strings `ei`/`emmet` for the two reserved ones), but arbitrary if two people happen to share a value under a type that isn't guaranteed unique (e.g. duplicate `Nickname` or `First Name` entries).

# An Agentic Tool

The `--id` flag is designed for piping. Every search hit — quotes included — carries an `id`, so drilling down is a uniform one-liner:

```sh
ei "memory leak" | jq -r '.[0].id' | ei --id
```

It also resolves fully-qualified message IDs from any supported integration, returning the original message content and session context:

```sh
ei --id "opencode:jeremys-macbook-pro:ses_38a7...:msg_c75b..."
ei --id "claudecode:my-machine:session-uuid:message-uuid"
ei --id "cursor:my-machine:composer-uuid:bubble-uuid"
ei --id "codex:my-machine:thread-uuid:evt_42"
ei --id "pi:my-machine:session-uuid:session-uuid/entry-id"
```

A quote's `id` and its `message_id` are different addresses: `id` identifies the quote record itself (what `ei --id` resolves, and what `ei fix quote`, `ei relink quote`, and `ei remove quote` take), while `message_id` identifies the *source message* it was lifted from — nullable, and shared by several quotes lifted from the same message, and what `ei create quote` quotes *from*. Pipe `message_id` to `ei --id` to read the original conversation; use `id` when you mean one specific quote.

# Harness Integrations

## Quick Install

```sh
ei --install
```

This wires Ei into every harness it finds on the machine — Claude Code, Codex, Cursor, OpenCode, Pi, and OMP — installing three things per harness: Ei's shipped skills, a **memory hook** that injects relevant memory before each prompt, and an **identity hook** that injects that harness's Ei persona record at session start. OpenCode is the one exception on the memory hook specifically: it only works through [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode)'s Claude Code compatibility layer, so base OpenCode gets skills and the identity plugin but no per-prompt memory injection. Detection is per-harness (Codex needs the `codex` binary on PATH; Cursor its application-support directory; OpenCode, Pi, and OMP their own config files), while Claude Code and the shared `~/.agents/skills/` directory are wired unconditionally. **MCP is removed by default** on Claude Code, Cursor, and Codex (see [MCP Server](#mcp-server) below) — every capability those MCP tools offered has a skill or CLI equivalent, so there's no longer a persistent `ei mcp` process sitting around per open session:

| Tool | Skills | Memory hook (before each prompt) | Identity hook (at session start) |
|------|--------|----------------------------------|----------------------------------|
| **Claude Code** | `~/.claude/skills/` | `~/.claude/hooks/ei-inject.ts` on `UserPromptSubmit` (registered in `~/.claude/settings.json`) | `~/.claude/hooks/ei-session-start.ts` on `SessionStart` — the fixed **Claude Code** persona |
| **Codex** | shared `~/.agents/skills/` | `~/.codex/hooks/ei-inject.ts` on `UserPromptSubmit` (registered in `~/.codex/hooks.json`) | `~/.codex/hooks/ei-session-start.ts` on `SessionStart` — the fixed **Codex** persona |
| **Cursor** | shared `~/.agents/skills/` | `~/.cursor/hooks/ei-inject.ts` on `beforeSubmitPrompt` (registered in `~/.cursor/hooks.json`) — Cursor's per-turn hook has no context output, so the hook renders `~/.cursor/rules/ei-context.mdc` (`alwaysApply: true`) instead | `~/.cursor/hooks/ei-session-start.ts` on `sessionStart`, via its `additional_context` output — the fixed **Cursor** persona |
| **OpenCode** | `~/.config/opencode/skills/` | Via [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode)'s Claude Code compatibility layer (reads `~/.claude/settings.json`) | `~/.config/opencode/plugins/ei-persona.ts` — resolves whichever agent the system prompt names |
| **Pi** | shared `~/.agents/skills/` | `~/.pi/agent/extensions/ei-integration.ts`, on `before_agent_start` | same extension — the fixed **Pi** persona, once per session branch |
| **OMP** | `~/.omp/agent/skills/` + shared `~/.agents/skills/` | `~/.omp/agent/extensions/ei-integration.ts`, on `before_agent_start` | same extension — the *active* persona, re-announced on every persona switch |

`~/.agents/skills/` is written on every `ei --install` run whether or not any of its readers are installed: Codex, Cursor, base Pi, and OMP each natively walk up to that cross-tool convention. Claude Code and OpenCode do not read it — they get their own copies above.

The Pi and OMP extensions additionally register `ei_search` and `ei_lookup` as **native tools** in that harness, so agents there can query Ei directly without MCP. Codex requires one-time hook trust: run `/hooks` in Codex and approve the two Ei hooks, or they silently never fire.

**Memory hook**: fires before every prompt, searches Ei with your prompt as the query (`-n 5`; `ei --recent -n 5` when the prompt is empty), and injects the result silently — no tool call required. Claude Code and Codex additionally pass the session transcript (Codex also `--session`/`--hook-source codex`) so the search is enriched with recent session context.

It never shows the same memory twice in one session. Each harness records the entity ids it has already surfaced and filters the next search against them, injecting nothing at all when nothing new survives: Claude Code, Codex, and Cursor keep that record in a per-session file under `~/.claude/`, `~/.codex/`, or `~/.cursor/ei-hook-state/<session id>.json` (0700 directory, 0600 files, pruned after 30 days by the identity hook, and the session id is validated before it ever reaches a path); Pi and OMP keep it as non-model-visible entries on the session branch, so a forked branch inherits what was surfaced before the fork and stays blind to its siblings. Cursor is the one that accumulates rather than appends — its shared rules file is re-rendered with this session's whole accumulated view every turn, capped at the 30 most recent items.

**Identity hook**: at session start, injects that harness's persona record — the `<ei-relationship>` block from `ei personas --format prompt` — so the agent knows who it is *to you* before it reads a word of your message. Claude Code, Codex, Cursor, and base Pi each use one fixed persona (**Claude Code**, **Codex**, **Cursor**, **Pi**); OMP resolves the active persona and re-announces on every switch; OpenCode's plugin reads the agent name out of the system prompt. Claude Code's `SessionStart` and Cursor's `sessionStart` are fire-and-forget, so a brand-new session's very first prompt can occasionally race ahead of the block — bounded and self-correcting, recorded in [ADR-034](../../docs/adr/ADR-034-session-boundary-hook-races-accepted.md). Codex, Pi, and OMP await it before the model call.

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

`ei --install` removes any Ei MCP registration from Claude Code, Cursor, and Codex by default — every MCP tool (`ei_search`, `ei_lookup`, `ei_fetch_message`, `ei_create`, `ei_update`, `ei_remove`, `ei_quote_create`, `ei_quote_fix`, `ei_quote_relink`) is a thin wrapper over the same CLI/corrections-queue code the `ei-search`, `ei-curate`, and `ei-persona` skills already teach agents to call directly. A persistent `ei mcp` process per open session bought nothing — it reloads state from disk fresh on every call, same as the CLI — and multiple such processes are what caused real Ei MCP processes to get mistaken for orphaned processes and killed.

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

1. **Before each message** — the hook searches Ei with your prompt as the query and injects the result silently as `[Ei Memory Context]`. Claude Code and Codex additionally enrich the search with the session transcript; Cursor, Pi, and OMP query the current prompt only. Results are a balanced mix across facts, topics, people, and quotes, not topics alone. You won't see this in your chat view; the agent does.
2. **At session start** — every harness gets the persona's `<ei-relationship>` block, all from the same `ei personas --format prompt` source. Claude Code, Codex, and Cursor inject it from a session-start hook (fixed **Claude Code** / **Codex** / **Cursor** persona); Pi injects it once per session branch (**Pi**); OMP injects the active persona and re-announces on every switch; OpenCode's plugin appends it to the system prompt for whichever agent it finds there. The block carries the persona's base prompt, its strongest traits as **Working Style**, its topics as **Shared Context**, and — when a Person record is linked to the persona — an **Ei Person Log** notice giving that log's current character count, plus a nudge to ask you for a reflection once the count passes 3,000. The agent knows its working style, traits, and shared history with you before the session begins.

For targeted, explicit mid-session queries — beyond whatever the hook already silently injected — agents reach for the `ei-search` skill (installed by default) to run `ei "query"` / `ei --id <id>` directly. The `ei_search`, `ei_lookup`, and `ei_fetch_message` MCP tools cover the same ground and remain available if you've manually re-registered MCP (see above).

## MCP Tools Reference

The MCP server exposes these tools to Claude Code, Cursor, Codex, and OpenCode:

| Tool | Description |
|------|-------------|
| `ei_search` | Balanced search across facts, topics, people, and quotes (personas excluded — pass `type: "personas"` explicitly to search those). Supports `type`, `persona`, `source`, `recent`, `limit` filters. Start here. |
| `ei_lookup` | Full-record lookup for any entity by ID — facts, topics, people, quotes, or personas. Use when you need complete details beyond the search summary. |
| `ei_fetch_message` | Retrieve a specific message by fully-qualified ID with optional `before`/`after` context window. Use when a quote result has a `message_id` and you want the original conversation. Routes to the correct source automatically. |
| `ei_create` | Create a new entity (fact, topic, person, or persona). Pass a full JSON record matching the entity's schema. Validates server-side; unknown fields are rejected. Returns the assigned id and the full stored record. Not available for quotes — use `ei_quote_create`, which verifies the text against its source message. |
| `ei_update` | Update a fact, topic, person, or persona by ID. For topic/person/persona this is an RFC 7396 merge patch (ADR-029) — pass ONLY the fields you're changing; every omitted field is left unchanged, `null` clears a field, arrays replace wholesale when present. `fact` is the one permanent exception and stays a full-record replacement (no defaults, nothing to merge onto). Server-owned/in-app-only fields (`tools`, `model`, `is_paused`, `is_archived`, `group_primary`, `groups_visible`, `exposure_current`/`exposure_desired`, provenance fields, …) are rejected as unrecognized on both. Not available for quotes: `entity_type: "quote"` is accepted by the schema but always rejects with a message naming `ei_quote_fix`/`ei_quote_relink`/`ei_remove` (ADR-012 tombstone). |
| `ei_remove` | Permanently remove a fact, topic, person, quote, or persona by ID. Use to drop bad extracted data that shouldn't be corrected, just deleted, or to delete a persona that's no longer needed. Reserved built-in personas ("ei", "emmet") can't be removed OR archived this way at all — `is_archived` left the external write contract entirely (ADR-031); use the TUI's `/archive` command instead. |
| `ei_quote_create` | Create a source-verified quote. Requires the source `message_id` and the exact `text`; the server matches that text against the resolved message and refuses if it isn't there. `speaker`, `channel`, `timestamp`, offsets, and the embedding are all derived from the source and cannot be supplied. Optional `start`/`end` are a consistency check, not a way to pick a later occurrence. |
| `ei_quote_fix` | Correct an existing quote's `text` by re-verifying it against the quote's *existing* source message. Never re-resolves a new source; links, provenance, speaker, channel, and timestamp are all preserved. Refuses if the quote has no `message_id`, its source no longer resolves, or the text isn't found. |
| `ei_quote_relink` | Change which facts/topics/people a quote is linked to (`data_item_ids`) and nothing else. Complete replacement list, not an additive delta; every target must resolve to an existing fact, topic, or person. Asserts no provenance, so it works on dangling and pre-attestation quotes too. |

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

**Quote**: `{ type, id, text, speaker, message_id, timestamp, linked_items[] }` — `message_id` links to `ei_fetch_message` for the original conversation; `id` is the stable identity `ei fix quote` / `ei relink quote` / `ei remove quote` take

**Persona**: `{ type, id, display_name, short_description, model, base_prompt, traits[], topics[] }`

**ID lookup** (`ei --id <id>` / `ei_lookup`): single object (not an array) with the same shape as above, plus a `linked_quotes` array for Fact, Topic, and Person records — quotes attributed to that entity, useful when auditing what was said about a person or topic. Persona ID lookups additionally get a `tools` field: the raw `tools` id array is replaced with a self-documenting `{ providerDisplayName: { toolDisplayName: boolean } }` map, so an agent can see exactly what's granted (and what else is grantable) without a separate lookup.

## Memory Management

`ei create`, `ei update`, and `ei remove` let you correct Ei's knowledge base directly — from the CLI or via MCP tools in your coding agent. Quotes are the exception: they have their own four verbs (`ei create quote`, `ei fix quote`, `ei relink quote`, `ei remove quote`), described below.

### Which types support which operations

| Type | create | update | remove |
|------|--------|--------|--------|
| fact | yes | yes | yes |
| topic | yes | yes | yes |
| person | yes | yes | yes |
| quote | `ei create quote` | — (tombstoned) | `ei remove quote` |
| persona | yes | yes | yes |

### Quote commands

A quote claims that a real person said a specific thing, so the commands that touch one are split by whether they assert that claim. Two verify it against the source message; two deliberately assert nothing:

```sh
ei create quote --message-id <message-id> --text "<exact substring of that message>" [--start N --end N]
ei fix quote --quote-id <quote-id> --text "<corrected text>" [--start N --end N]
ei relink quote <quote-id> --to <entity-id,entity-id,...>
ei remove quote <quote-id>
```

- **`ei create quote`** (MCP: `ei_quote_create`) mints a new quote only if `--text` is actually found in the message `--message-id` resolves to. `speaker`, `channel`, `timestamp`, the offsets, and the embedding are all derived from that message — there is no flag to supply them, and supplying them through `--json` is rejected. Read the message first with `ei --id <message-id>` and copy the text you want. If the verified span overlaps an existing quote already on that message, the two merge into one record instead of coexisting — see "Merging on overlap" below.
- **`ei fix quote`** (MCP: `ei_quote_fix`) corrects mistranscribed text by re-verifying it against the quote's *existing* source message. It never re-resolves a new source, and never lets you directly supply a link or provenance field. It can still merge: if the corrected span now overlaps another quote on that message, that quote is absorbed into this one (its links included) — see "Merging on overlap" below.
- **`ei relink quote`** (MCP: `ei_quote_relink`) repoints `data_item_ids` after a split or merge. `--to` is the complete new list (comma-separated, and `--to ""` clears every link); each id must resolve to a live fact, topic, or person. Because it asserts nothing about text or origin, it is the one quote write that works on a quote whose source message no longer resolves, or that predates attestation entirely (`message_id` is `null`).
- **`ei remove quote`** (MCP: `ei_remove` with `entity_type: "quote"`) deletes a quote.

`create` and `fix` either verify your text against a resolved source message or refuse — there is no partial success. The four refusals are `no source message to verify against` (the quote predates attestation), `source message could not be found`, `quote text not found in source message`, and `offset does not match the resolved text location`. Nothing is written in any of those cases.

**Merging on overlap.** `create`/`fix` treat an overlapping span exactly the way extraction does: the new/corrected span and every existing quote it overlaps on the same message are unioned into one record — widened span, deduplicated `data_item_ids`/`persona_groups` — instead of left as two overlapping records. `create` in that case never inserts a new quote at all; `fix` keeps its own id but can absorb a neighbour, which then no longer exists. A confirmed merge returns `{status: "merged", quote, absorbed, message}` — `absorbed` lists every quote id folded into the surviving record — instead of the plain created/fixed record. A queued (not-yet-confirmed) write is unaffected and still returns `{status: "queued", ...}`, with no `absorbed` field.

`ei update` on a quote is retired and always rejects, naming `ei fix quote`, `ei relink quote`, and `ei remove quote` in the error. The command is deliberately kept rather than deleted so an older installed skill gets a corrective message instead of "unknown type" — see `docs/adr/ADR-012-sunset-with-a-path-forward.md`.

Personas support create/update/remove too, but through a separate schema (`PersonaEntity`, not the fact/topic/person `DataItemBase` shape) — see the `ei create/update/remove persona` examples below and the `ei-persona` skill for guided authoring.

One persona-only field worth flagging for external callers: `external_reflection_only`. Set it, and Ei's automatic Reflection critic skips that persona at **both** gate points — it is never enqueued (`src/core/orchestrators/ceremony.ts`), and a critic already in flight returns without clearing the linked PersonLog or writing a `pending_update` (`src/core/handlers/heartbeat.ts`) — so an external, agent-driven reflection can consume that log first. It applies uniformly to every persona, reserved ones (`ei`/`emmet`) included. Unlike the in-app-only settings listed below, this one *is* externally writable (ADR-031 Full Access — `docs/adr/ADR-007-external-reflection-only.md` exists precisely so an outside agent can set it), through an ordinary persona merge patch:

```sh
ei update persona <persona-id> --json '{"external_reflection_only": true}'   # opt out of Ei's automatic critic
ei update persona <persona-id> --json '{"external_reflection_only": false}'  # opt back in
```

Flipping it on is not retroactive against a live Ei process: a critic dispatched before the correction drains can still clear the log, so re-read with `ei --id <persona-id>` before calling a run protected — see `docs/adr/ADR-008-accepted-write-races.md`. The `ei-reflect` skill drives this whole sequence.

### Update semantics: a merge patch, except for `fact`

`ei update`/`ei_update` implement RFC 7396 JSON Merge Patch (ADR-029) for topic, person, and persona: send only the fields you're changing. A field you omit is left completely unchanged — no more read-the-whole-record-back-in round trip. Send a field's new value to set it. Arrays (`traits[]`, `topics[]`, `identifiers[]`, `aliases`, `notes`) replace wholesale when present: sending `traits` means "these are ALL the traits now," not "append this one."

Sending `null` removes a field, but only where the record is still valid without it — RFC 7396 lets a patch null out any member, and the merged result is then re-validated, so a `null` that would leave a required field missing rejects the **whole** write and persists nothing. The fields you can actually clear:

| Type | Clearable with `null` |
|------|------------------------|
| Topic | `category` |
| Person | `name`, `identifiers`, `validated_date` — but not `name` and `identifiers` together, since a Person needs at least one of them |
| Persona | `pending_update` (a Critic-proposed identity revision; this is the only way to dismiss it, and a non-null value for it is always rejected) |

Everything else is either required (`name`, `description`, `sentiment`) or carries a default that the merged record must still satisfy (`person.relationship`), so `null` on it comes back as e.g. `Invalid person update: relationship: Required` and nothing is written. To blank such a field, send an empty value rather than `null` — `{"relationship":""}`, not `{"relationship":null}`.

`fact` is the one permanent exception (ADR-029's own stated exclusion — it has no defaults, so there's nothing to merge onto): `ei update fact`/`ei_update` with `entity_type: "fact"` still replace the whole record, exactly like before. (Quotes are not updateable this way at all — use the quote verbs above.)

Server-owned or in-app-only fields (`tools`, `model`, `heartbeat_delay_ms`, `context_window_ms`, `include_message_timestamps`, `context_boundary`, `is_paused`, `pause_until`, `is_archived`, `archived_at`, `group_primary`, `groups_visible`, `exposure_current`, `exposure_desired`, `last_ei_asked`, `learned_on`, `last_mentioned`, the computed-or-system-written pair `embedding` and `rewrite_length_floor`, and every provenance field — `learned_by`, `last_changed_by`, `sources`, `interested_personas`, `persona_groups`) are rejected as unrecognized fields on update, for every type that has them — not silently ignored, and not settable on create either (ADR-031). `embedding` and `rewrite_length_floor` are still written *for* you during the update; they are simply never yours to supply.

The rejection is deliberately generic — `Invalid <type> update: unrecognized field(s) present`, or `Invalid <type>: ...` on create, with MCP prefixing `Error: `. It does not name the offending key, because a property name is caller-controlled text and one carrying terminal control bytes must not reach stderr or an MCP response verbatim. The list above is therefore the reference for what to remove from your body.

Read-shape fields are the one exception, stripped rather than rejected so the documented `ei --id` → edit → `ei update` round-trip still parses. For fact/topic/person those are `id`, `type`, `last_updated`, and `linked_quotes`. Persona's list is deliberately wider — `id`, `type`, `entity`, `is_static`, `last_updated`, `last_heartbeat`, `description_embedding` — because `ei --id <persona>` spreads the full record plus its own discriminator rather than a narrower projection. `pending_update` is deliberately NOT stripped, so an explicit `pending_update: null` reaches the schema and actually clears it. On create there is no strip at all — an `id` in a create body is rejected like any other unknown key.

```sh
# fact: still a full replacement — fetch first, then submit the whole thing
ei --id abc-123
ei update fact abc-123 --json '{"name":"Field of Study","description":"Software Engineering / CS","sentiment":0,"validated_date":"2026-03-16T22:46:03.367Z"}'

# topic/person/persona: a merge patch — only the changed field(s)
ei update topic abc-123 --json '{"category":"Project"}'
ei update person abc-123 --json '{"validated_date":null}'   # null CLEARS a field — but only where the record stays valid without it (see below)
```

### Supplying the body: `--json` or `--json-file`

`ei create` and `ei update` take their JSON body from exactly one of two flags, for fact, topic, person, and persona. Passing both, or neither, is a usage error (exit 1) — there is no default and no stdin fallback.

```sh
ei update topic abc-123 --json '{"category":"Project"}'       # body on argv
ei update topic abc-123 --json-file /tmp/patch.json            # body from a file — identical semantics
```

`--json-file` exists for bodies you don't want on argv: a full persona identity or PersonLog revision is large, and argv is visible in process listings and shell history. Prefer it for anything persona-shaped — the `ei-reflect` skill uses it for exactly this reason. Ei never writes the file itself; you supply the path (a `mktemp` file is the convention), so the flag adds no predictable-path exposure of its own.

The four ways it fails, all exit 1, all before anything is read from or written to your data:

| Condition | Message |
|---|---|
| both flags | `ei update: pass either --json or --json-file, not both` |
| neither flag | `ei update requires --json '<json>' or --json-file <path>` |
| unreadable path | `Could not read --json-file "<path>": <reason>` |
| file isn't valid JSON | `Invalid JSON: <reason>` |

**`--json-file` is for `create` and `update` only, and not for quotes at all.** `ei create quote`/`ei fix quote`/`ei relink quote` build their body from their own discrete flags and accept `--json` as an overlay on top of those — they ignore `--json-file` entirely, so passing it there is not a usage error, it just leaves the body empty and you get a schema failure like `Invalid quote (create): message_id: Required; text: Required`. `ei update quote` is narrower still: it's the retired verb (see below) and rejects before either flag is ever read, so neither `--json` nor `--json-file` reaches parsing at all. Use `--json` with the quote verbs above.

### Examples (from `ei --help`)

```sh
ei create fact --json '{"name":"Field of Study","description":"CS","sentiment":0,"validated_date":""}'
ei update fact abc-123 --json '{"name":"Field of Study","description":"Updated","sentiment":0,"validated_date":""}'
ei create quote --message-id "opencode:my-machine:ses_abc:msg_def" --text "you guessed it"   # Attest a new quote against its source message
ei fix quote --quote-id abc-123 --text "you guessed it, again"   # Re-verify corrected text against the quote's existing source
ei relink quote abc-123 --to person-b-id            # Repoint a quote after splitting a bad merge
ei remove quote abc-123                             # Delete a quote
ei create persona --json '{"display_name":"Yoda","long_description":"Speaks in inverted syntax, wise and patient.","traits":[{"name":"Inverted speech","description":"Talks like Yoda","sentiment":0.7}],"topics":[]}'
ei update persona abc-123 --json '{"traits":[{"name":"Inverted speech","description":"Talks like Yoda","sentiment":0.7}]}'  # merge patch — every other field (display_name, topics, ...) stays as stored
ei update persona abc-123 --json-file /tmp/patch.json  # --json-file <path> takes the same body from a file instead of argv — prefer it for large/sensitive payloads (see the ei-reflect skill)
ei remove persona abc-123              # Remove a persona (reserved personas like "ei"/"emmet" can't be removed at all — use the TUI's /archive command instead)
ei remove fact abc-123
```

### Corrections queue

Changes written by `ei create/update/remove`, the quote verbs `ei create/fix/relink/remove quote`, and the MCP tools (`ei_create`/`ei_update`/`ei_remove`, `ei_quote_create`/`ei_quote_fix`/`ei_quote_relink`) all go through the same corrections queue (`$EI_DATA_PATH/corrections.json`). If a live Ei instance (TUI or daemon) is running, the Processor drains this file on every runLoop tick and applies changes to the live StateManager — no TUI restart required. If nothing is running, the write applies straight to `state.json` instead of waiting for a TUI session that may not start for days.

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
- **Cursor, Codex, Pi (base), OMP**: shared `~/.agents/skills/<skill-name>/` — written unconditionally, once, regardless of which of these are actually detected on the machine, since each of them natively discovers this cross-tool convention on its own (OMP reads it *in addition to* its own `~/.omp/agent/skills/` above). Claude Code does not read this path (confirmed in `install.ts`); OpenCode gets its own copy regardless and whether it also reads the shared path is unconfirmed.

Skills are installed automatically — any directory added under `skills/` in the Ei package gets copied to every location above on the next `ei --install` run.

### Currently shipped

| Skill | What it does |
|-------|-------------|
| `ei-search` | Deliberate, explicit read-path lookups — search, full-record fetch, original-message fetch — via the CLI (`ei "query"`, `ei --id <id>`), for the mid-conversation case beyond whatever the automatic context-injection hook already surfaced. Read-only. Read the full workflow at `skills/ei-search/SKILL.md`. |
| `ei-curate` | Safe agent-driven memory curation. Provides verified workflows for fixing merged records, bad attributions, stale facts, and mis-attributed quotes — using `ei create/update/remove` for facts/topics/people and the quote verbs `ei create/fix/relink/remove quote` for quotes, with explicit confirmation before every write. Read the full workflow at `skills/ei-curate/SKILL.md`. Load it in your harness with `/ei-curate`. |
| `ei-persona` | Safe agent-driven persona authoring. Guides creating, editing (traits/topics/description), archiving, or deleting a persona's *character* via `ei create/update/remove persona` — distinct from `ei-curate`, which corrects learned data rather than authoring identity. Read the full workflow at `skills/ei-persona/SKILL.md`. Load it in your harness with `/ei-persona`. |
| `ei-reflect` | Manual self-reflection for a coding-harness agent over its own accumulated Person log, for when the log fills faster than Ei's automatic Reflection critic can usefully consume it. Not a single file: a root dispatcher (`skills/ei-reflect/SKILL.md`) over two lenses in `skills/ei-reflect/lenses/`. The **Persona** lens (`lenses/persona.md`) is the identity half — it reviews the log against the current persona identity via the CLI (`ei personas`, `ei --id`) and rewrites traits/topics/descriptions with `ei update persona`. The **Agent** lens (`lenses/agent.md`) is the operating-contract half — the rules, sequences, and tool preferences that govern how the agent works *in this harness* — which it writes into the harness's own instruction files as a marked delimited region, touching no Ei record. The dispatcher resolves the persona, reads the log once, splits the evidence between the lenses, and clears the log with `ei update person` only once both lenses reach a terminal state — never while the Agent lens is still waiting on the user to choose a write target. `skills/ei-reflect/references/` holds the CLI surface, per-harness target files, and the configuration surfaces no file-based tool can reach. Read the full workflow at `skills/ei-reflect/SKILL.md`. Load it in your harness with `/ei-reflect`. |
| `ei-rewrite` | Manual, on-demand slimming of a bloated Topic or Person record — redistributes correctly-attributed content that's outgrown the record's contract (a Person profile accreting project detail, a Topic becoming a catch-all) into the right existing or new records, with mandatory Ei-native recon before creating anything. The on-demand counterpart to the automatic Rewrite ceremony (`src/core/handlers/rewrite.ts`) rather than a strict mirror of it: the manual workflow may spin off a new *Person*, which the automatic Person-rewrite phase's own prompt directs it never to do — that phase is instructed to redistribute into Topics only (not structurally enforced in code, just the prompt's own contract). Distinct from `ei-curate`, which fixes *wrong* data rather than *misplaced* data. Read the full workflow at `skills/ei-rewrite/SKILL.md`. Load it in your harness with `/ei-rewrite`. |
| `ei-generate` | Agent-driven document synthesis from Ei's memory — a runbook, onboarding doc, profile/job description, RoboBrain learning note, or period performance review, with a generic faceting technique for any type that has no seeded playbook yet — produced by the coding agent itself, not Ei's queued `/generate` feature, from CLI-only recon (facet search, multi-phrasing, `linked_quotes` graph-walk, self-filtering). Two independent gates run before anything is drafted: a names/handles-and-audience gate the moment a third party surfaces, and a persona-contamination gate requiring two independent sources for any character claim, since Ei's own AI personas share a knowledge base with the humans they describe. Read-only against Ei; the output file is untracked and placed wherever the user and agent agree. Read the full workflow at `skills/ei-generate/SKILL.md`. Load it in your harness with `/ei-generate`. |
