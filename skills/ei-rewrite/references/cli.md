# reference: the `ei` CLI commands this skill uses

This skill touches only **topic** and **person** records — never fact or
quote (this isn't a correctness fix; see `SKILL.md`'s boundary note), and
never persona (that's `ei-persona`'s territory). Everything below is a
trimmed subset of the same CLI `ei-curate` documents in full — if `ei-curate`
is also installed, its `references/cli.md` is the fuller reference; this file
covers exactly what a rewrite needs.

**Always trust live `ei --help` over this file if they disagree — the CLI
evolves.**

## Reading

```bash
ei --id <id>                      # full record for one entity
ei topic "<text>" -n 5            # semantic search, topics only
ei person "<text>" -n 5           # semantic search, people only
ei "<text>"                       # balanced search across facts/topics/people/quotes
```
`ei --id` on a **person** also returns `linked_quotes` — read it, but this
skill's writes never touch quotes directly; redistributing a Person's
description doesn't re-point any quote's `data_item_ids`. If your rewrite
would require moving a quote's attachment, that's `ei-curate` territory
(Recipe E), not this skill's.

## Creating

```bash
ei create topic --json '<json>'
ei create person --json '<json>'
```
- Mints a new `id`, computes the embedding, sets managed defaults.
- **Returns `{ "id": "…", "record": { … } }` — capture the `id`.** You'll
  need it if you have to reference the new record again this session (and
  for reporting to the user).
- See `references/mechanics.md` for the exact fields to supply.

## Updating — a merge patch, only the field(s) you're rewriting

```bash
ei update topic <id> --json '<json>'
ei update person <id> --json '<json>'
```
**`update` is RFC 7396 JSON Merge Patch (ADR-029).** Send only the field(s) you mean to
change — for this skill, that's almost always just `description` (occasionally `category`
for a topic, or `relationship` for a person, if the redistribution changes how you'd
summarize the relationship/category too). Everything you omit is left completely
unchanged — there is no "everything else got wiped" hazard to guard against anymore.

**Still do the read twice**: once during planning (`SKILL.md` step 1), and again
immediately before the actual `update` call (`SKILL.md` step 6) — for every existing record
you're about to write, not just the original. Planning and getting the user's approval
takes real time; if `description` itself changed in that window (another correction, an
extraction, a ceremony pass), the second read catches it before your patch overwrites a
change you never saw. **Diff the two reads on the field(s) you're about to send** — if
`description` (or whichever field you're patching) differs between the two reads, stop and
re-plan rather than writing; a field you're NOT touching can drift freely between the two
reads without any consequence now, since your patch will never mention it. Build the actual
write payload from the **second** read's value plus your approved edit — never from the
first.

Ei recomputes the embedding automatically on every update.

## Passing JSON safely

Don't hand-type JSON into a shell single-quoted string — descriptions
routinely contain apostrophes and quotes that will break your quoting. Prefer
`--json-file <path>`:
```bash
ei update person <id> --json-file /tmp/patch.json
```
Same body as `--json`, read from a file instead of argv. Or a scripting runtime: build the
patch object, `JSON.stringify`, pass the result as a single interpolated argument to
`--json`. Never hand-retype JSON from memory.

## There is no undo

Same as `ei-curate`: every write is an append-only correction — `update` now queues
`{ op: "patch", entity_type, id, patch, timestamp }` rather than a full record. A mistake is
fixed with *another* write, never reverted. `cat`-ing `corrections.json` is
not a reliable way to confirm a write landed — a running Ei instance drains
it within ~100ms, and with no live instance the CLI applies the correction
directly and leaves the file empty. **`ei --id <id>` after every write is the
reliable check** — it merges any undrained corrections on top of saved state,
so it reflects your write immediately regardless of which path applied.
