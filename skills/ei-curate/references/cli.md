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
**(managed)** are set by Ei — preserve them as-read; don't invent them. **Quotes are the
exception: they are never round-tripped** — see "Quote writes" below.

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

> **You never send a quote record back.** Everything above except `data_item_ids` and `text`
> is derived by Ei from the source message, and the two you *can* change each have their own
> dedicated command. `ei update` on a quote always rejects. See "Quote writes" below.

**fact** — `name, description, sentiment, validated_date`. `update` is a full-record
replacement for fact specifically (the one permanent exception, ADR-029) — no other fields
are part of the writable surface at all.

**topic** — `name, description, category, sentiment`. Preserve the existing `category` on
update unless you mean to change it. `exposure_current`/`exposure_desired` and every
provenance field (`sources`, `persona_groups`, `learned_by`, …) left the write contract
entirely (ADR-031) — you can read them, you cannot set or preserve them, and submitting
one is rejected as an unrecognized field, not silently ignored.

**person** — `name, description, sentiment, identifiers, relationship, validated_date`.
Same ADR-031 removal applies: `exposure_current`/`exposure_desired` and provenance fields
are read-only.

> **`linked_quotes` is read-only.** It appears when you *read* a person, but it is derived
> from quotes' `data_item_ids`. You never set it in a write — you change it *indirectly* by
> editing the quotes. It's harmless to leave in an `update` payload (Ei ignores it), but you
> no longer need to round-trip it, or anything else you're not changing — see "Updating"
> below.

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
- **Quotes are not created this way.** `ei create quote` is a separate, source-verified
  command with its own flags — see "Quote writes" below.

## Updating — a merge patch for topic/person, still full-record for fact

```bash
ei update <type> <id> --json '<json>'   # type: fact | topic | person
```

**`topic`/`person`: `update` is RFC 7396 JSON Merge Patch (ADR-029).** Send only the
field(s) you're actually changing; everything you omit is left completely unchanged. The
safe pattern:

1. `ei --id <id>` → get the current record, for context.
2. Build a small JSON object containing **only** the field(s) you intend to change (e.g.
   just `description` to fix a person's misattributed content).
3. Send just that to `update`.

**`fact`: `update` is still a full-record replacement (the permanent exception, ADR-029) —
any field you leave out is deleted.** Fetch the current record, change only the field(s)
you intend to, and send the whole record back.

Ei recomputes the embedding automatically on every update, so corrected text re-indexes for
search — you never manage embeddings yourself.


## Quote writes

A quote asserts that a real person really said a specific thing, so it has four narrow verbs
instead of the generic create/update/remove trio. Two of them verify that claim against the
source message; two deliberately assert nothing about it.

```bash
ei create quote --message-id <message-id> --text "<exact text from that message>" [--start N --end N]
ei fix quote --quote-id <quote-id> --text "<corrected text>" [--start N --end N]
ei relink quote <quote-id> --to <entity-id,entity-id,...>
ei remove quote <quote-id>
```

- **`ei create quote`** attests a new quote. Read the source message first (`ei --id
  <message-id>`), copy the text verbatim, and pass both. Ei finds that text in the message and
  derives `speaker`, `channel`, `timestamp`, `start`, `end`, and the embedding from it — there
  is no flag for those, and smuggling them in through `--json` is rejected.
- **`ei fix quote`** corrects mistranscribed text, re-verified against the quote's *existing*
  source message. It never re-resolves a different source, and never lets you directly supply
  a link. It can still merge: if the corrected span now overlaps another quote on that
  message, that quote is absorbed into this one instead of the two coexisting.
- **`ei relink quote`** is the canonical re-point: it changes `data_item_ids` and nothing else.
  `--to` is the **complete** new list, comma-separated — preserve the ids you want to keep, and
  use `--to ""` to clear every link. Every id must resolve to a live fact, topic, or person.
- **`ei remove quote`** deletes one quote.

The canonical re-point (fixing a mis-attributed quote) is now one command, no round-trip:
```bash
# 1) read it        →  ei --id <quote-id>          (see its current data_item_ids)
# 2) re-point it    →  ei relink quote <quote-id> --to "<correct-person-id>,<other-id-to-keep>"
# 3) verify         →  ei --id <quote-id>   and  ei --id <person-id>
```

`create` and `fix` refuse and write nothing if: the quote has `no source message to verify
against` (its `message_id` is `null` — it predates attestation), the `source message could not
be found`, the `quote text not found in source message`, or `offset does not match the
resolved text location` (if you pass `--start`/`--end`, pass both, and they must match what Ei
finds). A refusal is not a partial write — nothing changed, so fix the input and retry.

`relink` and `remove` assert nothing about text or origin, so they are the two verbs that
still work on a quote whose source can no longer be resolved, or that predates attestation.
If `ei fix quote` refuses with "no source message to verify against", the text on that quote
simply cannot be corrected — say so; do not reach for another command.

## Removing (destructive)

```bash
ei remove <type> <id>                   # type: fact | topic | person | quote
```
Deletes the record. For a person, this also orphans that person's quote links. Only remove
records that are genuine junk/duplicates **after** you've moved any real quotes off them.
`ei remove quote <id>` is the same command for a single quote.

## Passing JSON safely

Inlining JSON with quotes/apostrophes into a shell single-quoted string is a footgun
(descriptions like `the middleware ('MW')` will break your quoting). Prefer one of:

- **`--json-file <path>`:** write the JSON to a file, then
  `ei update person <id> --json-file /tmp/patch.json` — same body, but it never puts the
  JSON on argv.
- **A scripting runtime:** read the record, parse it, mutate the object, `JSON.stringify`,
  and pass the string as a single argument (interpolation escaping handles the quotes). For
  `topic`/`person` this only needs to be the field(s) you're changing, not the whole record;
  for `fact`, build the whole record (the one permanent full-replacement exception).


Whatever you do, **do not hand-retype a record** — fetch it and mutate it programmatically,
or you *will* drop a field.

## There is no undo

Every write is recorded as a correction: `{ op: "upsert" | "remove", entity_type, id, record,
timestamp }` for a full-record write (every `create`, and `fact`'s own `update`) or
`{ op: "patch", entity_type, id, patch, timestamp }` for a topic/person `update`, and one of
`quote.create` / `quote.fix` / `quote.relink` / `quote.remove` for a quote. Where it lands
machine — don't assume it always sits in `corrections.json` waiting to be read:

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
