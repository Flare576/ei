# reference: the `ei` CLI for curation

The Ei CLI is how you read and write memory. It is a thin wrapper over the local data
store. Everything below was true at time of writing — **always run `ei --help` first and
trust it over this file** if they disagree (the CLI evolves).

## Invocation

- Prefer `ei` (on PATH). If it's not found, use `bunx ei-tui` with the same arguments.
- Successful read/write commands print **JSON** to stdout. Validation and usage failures print
- human-readable text to stderr and exit non-zero.

## Reading (safe, do this constantly)

```bash
ei "<search text>"              # search everything, top 10
ei <type> "<search text>"       # search one type: person|people, fact|facts, topic|topics, quote|quotes
ei -n 5 "<text>"                # limit results
ei --recent ["<query>"]         # most recently mentioned
ei --persona "<Name>" "<query>" # filter to what a persona learned
ei --source <prefix> "<query>"  # filter by source prefix, e.g. "slack", "opencode:my-machine:ses_abc"
ei --id <id>                    # full record for one entity (also accepts an id on stdin)
```

`ei --id <id>` is your workhorse. For a **person** it returns the full record **plus a
`linked_quotes` array** — the reverse index of every quote attached to that person. That
array is how you see a bad merge's blast radius.

## The record shapes

You must round-trip these on `update` (see "full-record round-trip" below). Fields marked
**(managed)** are set by Ei — preserve them as-read; don't invent them.

**person**
```
name, description, relationship, sentiment,
identifiers: [ { type, value, is_primary? } ],   # e.g. {type:"Full Name",...}, {type:"Slack",value:"jdoe"}, {type:"Email",...}
sources: [ "slack:C123…", … ]                    # (managed) origin channels/sessions
persona_groups: […]                              # (managed)
exposure_current, exposure_desired,              # (managed)
validated_date, learned_on, last_mentioned, last_updated,      # (managed)
learned_by, last_changed_by, interested_personas, rewrite_length_floor,      # (managed)
linked_quotes: [ { id, text, speaker, timestamp } ]            # (READ-ONLY projection — see note)
```

**quote**
```
text, speaker, channel,
message_id,                 # provenance pointer, e.g. "slack:TEAM:CHANNEL:TS" (see provenance.md)
data_item_ids: [ … ],       # THE LINK: ids of the facts/topics/people this quote is
                             # attached to — must resolve to one of those three or the
                             # write is rejected (never a persona or another quote)
persona_groups: […],        # (managed)
timestamp, start, end, created_at, created_by   # (managed)
```

**fact** — `name, description, sentiment, validated_date` (+ managed: sources, persona_groups, …)

**topic** — `name, description, category, sentiment` (+ managed: sources, persona_groups,
exposure_*, rewrite_length_floor, …). Preserve the existing `category` on update unless you
mean to change it.

> **`linked_quotes` is read-only.** It appears when you *read* a person, but it is derived
> from quotes' `data_item_ids`. You never set it in a write — you change it *indirectly* by
> editing the quotes. It's harmless to leave in an `update` payload (Ei ignores it), so the
> simplest safe move is: send the record back exactly as `ei --id` gave it to you, with only
> your intended edits applied.

## Creating

```bash
ei create <type> --json '<json>'      # type: fact | topic | person
```
- Mints a new `id`, computes the embedding, sets managed defaults — you only supply the
  meaningful fields (e.g. for a person: `name`, `description`, `relationship`, `sentiment`,
  `identifiers`).
- **Returns `{ "id": "…", "record": { … } }` — capture that `id`.** Downstream steps
  (re-pointing quotes) need it.
- The returned `record` is already sanitized for CLI/MCP output hygiene — **no `embedding`
  array is returned** even though Ei computed and stored one internally.
- **You do not `create` or `remove` quotes through the public Ei CLI/MCP tools.** Quotes are
  produced by Ei's extraction from real conversations; public curation support for quotes is
  **update-only** (re-point / fix).

## Updating — FULL-RECORD ROUND-TRIP (read this twice)

```bash
ei update <type> <id> --json '<json>'   # type: fact | topic | person | quote
```

**`update` REPLACES the entire record. Any field you leave out is DELETED.** It is not a
patch/merge. The only safe pattern:

1. `ei --id <id>` → get the current, complete record.
2. Change **only** the field(s) you intend to change (e.g. a quote's `data_item_ids`, a
   person's `description`).
3. Send the **whole** record back to `update`.

Ei recomputes the embedding automatically on every update, so corrected text re-indexes for
search — you never manage embeddings yourself.

The canonical re-point (fixing a mis-attributed quote):
```bash
# 1) read it       →  ei --id <quote-id>
# 2) swap the link →  set data_item_ids to [ "<correct-person-id>" ]
# 3) write it back →  ei update quote <quote-id> --json '<full record with new data_item_ids>'
```

## Removing (destructive)

```bash
ei remove <type> <id>
```
Deletes the record. For a person, this also orphans that person's quote links. Only remove
records that are genuine junk/duplicates **after** you've moved any real quotes off them.

## Passing JSON safely

Inlining JSON with quotes/apostrophes into a shell single-quoted string is a footgun
(descriptions like `the middleware ('MW')` will break your quoting). Prefer one of:

- **Temp file:** write the JSON to a file, then `ei update person <id> --json "$(cat /tmp/rec.json)"`.
- **A scripting runtime:** read the record, parse it, mutate the object, `JSON.stringify`,
  and pass the string as a single argument (interpolation escaping handles the quotes). This
  is the most robust for multi-step edits and lets you round-trip the full record without
  hand-copying fields.

Whatever you do, **do not hand-retype a record** — fetch it and mutate it programmatically,
or you *will* drop a field.

## There is no undo

Every write is recorded as a correction: `{ op: "upsert" | "remove", entity_type, id, record,
timestamp }`. Where it lands depends on what's running on this machine — don't assume it
always sits in `corrections.json` waiting to be read:

- **A live Ei instance is running** (holds `ei.lock`) → the correction is appended to
  `$EI_DATA_PATH/corrections.json`, and the running Processor drains it into the live state
  within ~100ms.
- **No live instance, but `state.json` exists** → the CLI applies the correction *directly*
  into `state.json` itself, immediately. `corrections.json` is left empty — there is nothing
  sitting in it to inspect, even though the write fully succeeded.
- **No live instance, no `state.json`, but `state.backup.json` exists** (a sync account that
  hasn't opened Ei on this machine yet) → the correction queues in `corrections.json` and is
  applied the next time Ei starts and pulls state.
- **Neither `state.json` nor `state.backup.json` exists** → the write fails outright with an
  error (no Ei data found at that path) — nothing is queued.

Consequences you must design around:
- **No rollback command.** To reverse a change you make *another* write (e.g. `update` it back,
  or re-`create` a removed record — which gets a **new** id, so its old quote links are lost).
- **`remove` is the most dangerous op** — it discards the id other records may point to.
- **`cat`-ing `corrections.json` is not a reliable way to confirm a write** — in the common
  case (no live Ei instance open while you're running the CLI), the correction is applied and
  the file is already back to `[]` by the time your command returns. Don't treat an empty file
  as "nothing happened."
- Therefore: **plan and get confirmation before writing**, and after writing, **re-read to
  verify** — `ei --id <id>` is the reliable check: every read merges any not-yet-drained
  corrections on top of the last saved state, so it reflects your write immediately no matter
  which of the cases above applied.
