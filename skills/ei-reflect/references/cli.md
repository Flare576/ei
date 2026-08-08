# reference: the `ei` CLI commands this skill uses

Everything this skill reads or writes in Ei goes through the CLI. **No raw
file reads, no `jq` against Ei's storage** — the CLI merges saved state with
queued corrections before returning anything, so it is the only read path that
reflects a write you just made.

**Always trust live `ei --help` over this file if they disagree — the CLI
evolves.**

## Invocation

Prefer `ei` (on PATH). If it isn't found, use `bunx ei-tui` with identical
arguments — the same fallback `ei-curate`, `ei-persona`, `ei-search`, and
`ei-rewrite` all use. Successful commands print JSON to stdout; validation and
usage failures print human-readable text to stderr and exit non-zero.

## Reading

```bash
ei personas -n <N>                  # list ALL personas (no query), id + display_name
ei --id <id>                        # full record for one entity (persona, person, …)
ei person -n <N>                    # browse people, most-recently-mentioned first
```

`ei --id` is the workhorse. On a **person** it also returns `linked_quotes`;
this skill never writes quotes, but read it — a log you're about to clear may
have quotes attached to it.

**The CLI does support a name query — and this skill never uses it.** Two
independent reasons, either one sufficient:

1. **It isn't an identity check.** `ei personas <query>` does a
   case-insensitive **substring** match, sorts every hit by `last_updated`
   descending, then truncates to `-n`. So `-n 1` doesn't mean "the one that
   matches" — it means "the most recently updated of however many matched,"
   with the ambiguity discarded before you ever see it. Nothing enforces
   display-name uniqueness across Personas either, so two can legitimately
   share one.
2. **A `display_name` is unvalidated user-controlled text** — `z.string().min(1)`
   and nothing more — and this skill does not put such text on a command line.
   Not inline, not quoted after `--`, not as a `jq --arg`. There is no quoting
   discipline to get right if the value never reaches a command at all.

So: take **one** unfiltered list and narrow it by **reading** it
(`../SKILL.md` Step 1a). Names get compared by you, against a list you already
hold — never by a command you construct out of one.

---

## Enumerating every linked Person record

`../SKILL.md` Step 1 needs **all** Person records linked to your persona, not the
first one.

### Why not `--identifier`

```bash
ei --identifier "Ei Persona" "$PERSONA_ID"   # ← returns ONE record. Don't use it here.
```

`--identifier` matches the **first** person whose identifier array contains
that value. The CLI's own documentation concedes the result is arbitrary when
the identifier isn't unique under its type. `Ei Persona` is *meant* to be
unique — one Persona id per persona — but the case this check exists for is exactly
the case where that assumption has already broken.

Ei's automatic ceremony, which reads state directly and therefore sees every
linked record, **refuses to run reflection at all** when a Persona is linked
to more than one Person record. It writes the user a message instead:
*"…is connected to multiple person records: X and Y… Reflection has been
paused until this is resolved."* If a first-match pick here quietly returns
one of those two, you would then clear the wrong log — the one thing the
automatic path was careful enough to avoid.

### The all-match enumeration

Browsing with no query returns people unfiltered, most-recently-mentioned
first, and each result already carries its `identifiers` array — so one call
plus a filter gives you the complete set. No per-record `ei --id` needed.

```bash
PEOPLE_JSON=$(mktemp)
ei person -n 500 > "$PEOPLE_JSON"

# Completeness check: if this equals your -n, the limit bound. Raise it and re-run.
jq 'length' "$PEOPLE_JSON"

jq --arg pid "$PERSONA_ID" '
  [ .[]
    | select(any(.identifiers[]?;
        (.type | ascii_downcase) == "ei persona" and .value == $pid))
    | { id, name, chars: (.description | length) }
  ]' "$PEOPLE_JSON"

rm -f "$PEOPLE_JSON"
```

The `ascii_downcase` on `.type` and the exact `.value` comparison mirror the
matching semantics Ei uses internally — identifier types are case-insensitive
and user-extensible, values are exact.

Read the result count:

| Result | Meaning |
|---|---|
| exactly 1 | Your log. Take its `id` as `PERSON_LOG_ID`. |
| more than 1 | **Stop and ask the user which.** Show the names and `chars`. Never pick. This is usually a real identifier problem — `ei-curate` fixes it. |
| 0 | No Person record is linked to this persona yet. Nothing to reflect on, nothing to clear. |

---

## Writing — a merge patch, plus one field you must set explicitly

```bash
ei update persona <persona-id> --json-file <path>
ei update person  <person-id>  --json-file <path>
```

**`update` is now RFC 7396 JSON Merge Patch.** Send only the field(s) you
mean to change. Anything you omit is left completely unchanged — you no
longer round-trip the whole record to make one edit, and you can no longer
destroy a field by forgetting to include it.

1. `ei --id <id>` → read the current record, for context and for the
   diff-check below — not because you need to resend it.
2. Build a small JSON object containing ONLY the field(s) you mean to
   change.
3. Send just that.

**Still re-read immediately before writing**, and diff against your Step 1
read. Reflection conversations take real time; if a field you're ABOUT TO
CHANGE moved in that window, stop and re-confirm with the user before
overwriting it. This is a narrower check than before — you're only
comparing the fields your patch touches, not every field on the record —
but it still matters, because a patch and a concurrent edit to the *same*
field can still race (ADR-029 narrows this race, it doesn't close it).

Ei recomputes the embedding automatically on every update.

### `pending_update` no longer clears itself — you must clear it explicitly

**This is the one real behavior change this skill must adopt, not just
relearn.** Before merge-patch, ANY persona update wiped `pending_update` as
a side effect of replacing the whole record — that was the entire
mechanism `../lenses/persona.md`'s "write this even if nothing changed"
step relied on. Merge-patch means omission now means "leave unchanged," so
an update that never mentions `pending_update` **leaves a stale Critic
proposal in place**. If your write is meant to resolve one, your patch MUST
include `"pending_update": null` explicitly — that is the only value it
accepts (a non-null value is always rejected; this field is Clearable, not
settable). See `../lenses/persona.md` for exactly when this applies.

### The omitted-boolean hazard — fixed, not just documented

`is_paused`/`is_archived`/`tools`/`model` and several other persona settings
left the external write contract entirely (ADR-031) — there is no flag or
JSON field that touches them through this CLI/MCP path at all anymore, so
there is nothing to omit. `external_reflection_only` stays externally
writable, and — this is the actual fix, not a workaround — omitting it from
a patch now means exactly what it should: unchanged. If Step 1b turned it
on to protect a log mid-reflection, a later patch that never mentions it
can no longer silently turn it back off.

### Server-managed fields

Every field NOT in `../SKILL.md`'s edited set, and not explicitly `null`ed,
survives an update untouched now — including `pending_update` (see above),
which is exactly the opposite of the old "every update drops it" behavior.
Genuinely system-owned fields (`id`, `last_updated`, `description_embedding`,
`is_static`, `last_heartbeat`) are still never yours to set; sending them
back (e.g. echoed from an `ei --id` read) is harmless — they're silently
ignored, not rejected — but you never need to include them at all.

## Passing JSON safely

Descriptions are prose-heavy and routinely contain apostrophes and quotes
that will break shell quoting. **Do not hand-type the JSON into a
single-quoted string, and do not open an editor** — no path in this skill
may require `$EDITOR`.

```bash
EDIT_JSON=$(mktemp)
# write ONLY the changed field(s) — e.g. {"traits":[...]} or
# {"pending_update":null} — to "$EDIT_JSON" with your own file-writing tool
ei update persona "$PERSONA_ID" --json-file "$EDIT_JSON"
rm -f "$EDIT_JSON"
```

`--json-file <path>` (not `--json "$(cat ...)"`) is this skill's preferred
write mode — it takes the exact same body from a file instead of putting it
on argv, which matters here specifically: these payloads carry the full
persona identity and the full person log, the most sensitive writes in this
codebase. `mktemp` rather than a predictable `/tmp/persona-edit.json` for
the same reason `--json-file` exists — don't leave the file at a guessable
path either.

Or use a scripting runtime: build the patch object, `JSON.stringify`, pass
the result as one interpolated argument to `--json`. Either way, never
hand-retype JSON from memory.

## Clearing the PersonLog

Only ever from `../SKILL.md` Step 6, only after the joint gate passes.

```bash
ei --id "$PERSON_LOG_ID"        # fresh read — NOT the Step 2 copy
```

Confirm `description` isn't already `""` (see the no-op note in
`../SKILL.md` Step 6), then send a patch containing only that one field:

```bash
LOG_JSON=$(mktemp)
echo '{"description":""}' > "$LOG_JSON"
ei update person "$PERSON_LOG_ID" --json-file "$LOG_JSON"
rm -f "$LOG_JSON"
```

Then `ei --id "$PERSON_LOG_ID"` and confirm `description` is `""`.
`linked_quotes` is a read-only derived projection either way — it was never
part of the writable schema, patch or otherwise, so there's no reason to
include it.


## There is no undo

Every write is an append-only correction. A mistake is fixed with *another*
write, never reverted — and once a PersonLog `description` is set to `""`, the
prior text is gone.

`cat`-ing `corrections.json` is not a reliable way to confirm a write landed.
Which path a correction takes depends on two conditions, not one:

| Live Ei running? | Local `state.json` present? | What happens |
|---|---|---|
| yes | either | **Queued** — a live instance drains it within ~100ms |
| no | yes | **Self-drains directly** into state; the queue file is left empty |
| no | no (only `state.backup.json`) | **Queued** for the next launch to drain |
| no | neither | Error — no Ei data at this `EI_DATA_PATH` |

So "nothing is running, therefore it applied directly" is wrong on a
synced-but-closed machine that has only a backup. **`ei --id <id>` after every
write is the reliable check regardless** — it merges any undrained corrections
on top of saved state, so it reflects your write immediately whichever path
applied it.

You never need to stop Ei to run a reflection.
