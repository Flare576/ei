---
name: ei-search
description: >
  Use when someone wants to deliberately search or look something up in Ei —
  the user's persistent memory store — mid-conversation, beyond whatever
  context was already silently injected. Triggers: "what does Ei know about
  X", "search Ei's memory for X", "look up X in Ei", "check Ei for context on
  Y", "find out if Ei has info about Z", "does Ei know who X is", "pull up
  what Ei has on this topic", "search my memory for X", "what has [persona]
  learned about X", "fetch that message/quote Ei found", "get the full
  record for this fact/person/topic/quote". This is the deliberate, targeted
  read path — distinct from the automatic per-turn context injection that
  already runs silently via hooks/plugins before this skill is ever
  invoked. Reach for this skill when the auto-injected context didn't
  surface something relevant, when you need the full record behind a
  summarized result, when you need to fetch the original conversation
  behind a quote, or when you need to scope results to what a specific
  persona has learned. Read-only: creating, correcting, or removing records
  is the `ei-curate` (facts/topics/people/quotes) or `ei-persona` (persona
  identity) skill's job, not this one.
---

# Ei Search — looking things up in Ei mid-conversation

You are helping someone pull a specific piece of information out of **Ei** —
the user's persistent memory, built from their conversations, Slack, and
coding sessions. Something wasn't already surfaced by the automatic context
injection, or you need the full detail behind a summarized item, or the
original quote/conversation behind something Ei surfaced. This is a
**read-only** skill: search and lookup, nothing else.

---

## Is this the right skill?

Ei already injects relevant context automatically, every turn, before you
ever see the user's message: a hook searches Ei using the prompt (plus
recent conversation history) and silently prepends a `## Ei Memory Context`
block to what you read. You never call a tool for that — it already
happened, passively, without you or the user doing anything.

This skill is for the **deliberate, explicit, mid-conversation case**: you
(or the user) decide to go look something up specifically, right now, beyond
whatever was already silently injected. Reach for it when:

- The auto-injected context **didn't surface something** you now realize is
  relevant — it's a best-guess search off the current prompt, and it can miss.
- You need the **full record**, not the injected summary — injected context
  is trimmed/summarized to fit a token budget; the full record has fields
  the summary dropped.
- A quote surfaced (injected or searched) and you need the **original
  conversation** it came from, not just the isolated sentence.
- You need to scope results to **one persona's** knowledge specifically
  (e.g. "what has Beta learned about the auth refactor") instead of the
  whole knowledge base.

If instead the goal is to **fix** something wrong in Ei's memory (a bad
merge, a mis-attributed quote, a stale fact) → that's `ei-curate`. If the
goal is to **author a persona's character** (traits, voice, description) →
that's `ei-persona`. This skill only reads; it never writes.

---

## Before you start

Confirm the CLI is reachable: `ei --help` (or `bunx ei-tui --help` if `ei`
isn't on PATH). **The live `--help` output is the source of truth** for the
exact command surface — this skill is a guide, but the CLI evolves.

---

## Command reference

| Command | Returns |
|---|---|
| `ei "query"` | Balanced search across all 5 types (facts, people, topics, quotes, personas), ranked by relevance, up to 10 results |
| `ei -n N "query"` | Same, capped at `N` results |
| `ei facts -n N "query"` | Facts only |
| `ei people -n N "query"` | People only |
| `ei topics -n N "query"` | Topics only |
| `ei quotes -n N "query"` | Quotes only |
| `ei personas -n N "query"` | Personas only — matches display name first, falls back to semantic search over persona descriptions |
| `ei --persona "Name" "query"` | Scope any of the above to what a specific persona has learned — not the persona's own identity record, its accumulated facts/topics/people/quotes |
| `ei --recent` | Most recently mentioned items, no query needed — browse by recency |
| `ei --persona "Name" --recent` | Recent items scoped to one persona's knowledge |
| `ei --source <prefix> "query"` | Filter any of the above to entities from a specific source — prefix match, e.g. `cursor`, `codex:my-machine` |
| `ei --id <id>` | Full-record lookup — entity id or fully-qualified message id (see below) |
| `echo <id> \| ei --id` | Same lookup, id piped via stdin |
| `ei "query" \| jq '.[0].id' \| ei --id` | Idiomatic search-then-drill-down: search, take the top hit's id, fetch its full record |

Type aliases work singular or plural: `fact`/`facts`, `person`/`people`,
`topic`/`topics`, `quote`/`quotes`, `persona`/`personas`. Short flags:
`-n` (number), `-p` (persona), `-s` (source), `-r` (recent).

### Two id formats

`--id` accepts two different shapes and resolves them differently — it
tries message resolution first, then falls back to entity lookup, so you
never have to pick which path, just pass the id:

- **Entity id** — a short guid, e.g. `2aa93a36-3ad3-4537-8832-7f60067c3bcf`.
  Identifies one fact, topic, person, quote, or persona row.
- **Message id** — fully-qualified, `provider:machine:session:id`, e.g.:
  - `opencode:jeremys-macbook-pro:ses_38a7...:msg_c75b...`
  - `claudecode:my-machine:session-uuid:message-uuid`
  - `cursor:my-machine:composer-uuid:bubble-uuid`
  - `codex:my-machine:thread-uuid:evt_42`
  - `pi:my-machine:session-uuid:session-uuid/entry-id`
  - `ei:uuid` (persona-to-persona / internal Ei conversations)

Quote results carry a `message_id` in this format — pipe it to `ei --id` to
read the original exchange it came from.

---

## What each command is actually for

(This is straight from Ei's own tool definitions — the minimum you need
before searching, plus what changes when you're driving it from the CLI.)

**Search (`ei` / `ei <type>`)** — searches a persistent memory store built
from conversations. The type boundaries aren't always obvious:

- **facts** are ONLY user demographics: name, age, job title, location,
  family structure, physical traits.
- **topics** are everything else the human has interest, opinion, or stake
  in — hobbies, preferences, projects.
- **people** are named individuals — human contacts, not AI personas.
  Person results carry an `identifiers[]` array (GitHub handle, Discord,
  email, nickname) — query by any handle or name to find what Ei knows
  about that person.
- **quotes** are verbatim things said.
- **personas** are AI agent identities with traits and working style —
  search by name (e.g. "Sisyphus") or by a description of their role (e.g.
  "primary coding agent"); distinct from **people**, which are humans.

Omit the query and pass `--recent` to browse without semantic filtering.

**Full-record lookup (`ei --id <entity-id>`)** — use once search has
narrowed to a candidate and you need everything about it: all fields,
traits, identifiers, not just the search summary. For facts, topics, and
people specifically, the result also includes `linked_quotes`: every quote
attributed to that entity — the fastest way to see the full blast radius of
a person/topic before assuming a record is simple (though acting on what you
find there is `ei-curate`'s job, not this one's).

**Message fetch (`ei --id <message-id>`)** — retrieves the original message
a quote or reference came from, routed automatically to the right source by
the id's prefix: Ei's own state, OpenCode SQLite, Claude Code JSONL, the
Cursor DB, or Codex rollout history. Use this when a quote's phrasing is
ambiguous, or you want the surrounding exchange rather than the isolated
sentence. **CLI caveat**: `ei --id` on a message always fetches just that one
message — it has no `before`/`after` flags to expand the window. (The MCP
`ei_fetch_message` tool, where available, additionally accepts `before`/
`after` counts to pull in surrounding messages; if you're on an MCP-enabled
harness and specifically need that expanded window, that tool covers a case
the CLI path here doesn't.)

---

## Output shapes — know this before you make a second call

All search commands return **arrays**; every result has a `type` field.

| Type | Shape |
|---|---|
| Fact / Topic | `{ type, id, name, description, sentiment, ...type-specific fields }` |
| Person | `{ type, id, name, description, relationship, sentiment, identifiers[] }` |
| Quote | `{ type, text, speaker, message_id, timestamp, linked_items[] }` — **no `id`, on purpose**: quotes are addressed by `message_id` (fetch the original message), not an editable entity id |
| Persona | `{ type, id, display_name, short_description, model, base_prompt, traits[], topics[] }` |

`ei --id <entity-id>` returns a **single object** (not an array), same shape
as above, plus a `linked_quotes[]` array for facts/topics/people. Persona
id-lookups additionally get a `tools` field as a self-documenting
`{ providerDisplayName: { toolDisplayName: boolean } }` map.

`ei --id <message-id>` returns a different shape entirely: message content
plus its session/source context (`{ message, before, after, session/source }`
depending on the integration) — not an entity at all.

Don't `--id` every search hit reflexively. If the search result already has
what you need (name, description, text), you're done — reach for `--id`
only when you actually need one of the extra fields listed above.

---

## Guardrails

- **Read-only.** This skill never creates, updates, or removes anything. A
  bad record → `ei-curate`. A persona's character → `ei-persona`.
- **`--help` is the source of truth.** If a command here doesn't match live
  `ei --help` output, trust `--help` and adapt.
- **Quotes have no `id`.** Don't try `ei --id <quote-id>` — quotes are found
  via search and read via their `message_id`.
- **This is the explicit-call path, not a substitute for the passive
  injection.** Don't re-run a broad search "just in case" every turn — the
  hook already did that before you saw the message. Use this skill when you
  have a specific, unmet information need.
