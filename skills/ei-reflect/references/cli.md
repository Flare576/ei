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

## Writing — full-record round-trip

```bash
ei update persona <persona-id> --json '<json>'
ei update person  <person-id>  --json '<json>'
```

**`update` REPLACES the entire record. Any field you omit is deleted.** The
only safe pattern:

1. `ei --id <id>` → the current, complete record.
2. Change only the field(s) you mean to change.
3. Send the **whole** record back.

**Do the read twice** — once while planning, and again immediately before the
`update` call. Reflection conversations take real time; if the record moved in
that window, the second read catches it before a stale full-record replacement
silently overwrites someone else's change. Diff the two reads on **every**
field, not just the ones you meant to change, and build the payload from the
**second** read. If they disagree on anything at all, stop and re-confirm.

Ei recomputes the embedding automatically on every update.

### The omitted-boolean hazard

Three persona booleans are schema-defaulted to `false` on update:

| Field | Omitted → | When unset, the read shows |
|---|---|---|
| `is_paused` | `false` | `false` |
| `is_archived` | `false` | `false` |
| `external_reflection_only` | `false` | **absent** — the key isn't there at all |

They don't merely fail to update — they come back **flipped off**. Omitting
`is_paused` unpauses a paused persona. Omitting `external_reflection_only`
re-enrols a persona that had opted out of Ei's automatic critic — which, if
`../SKILL.md` Step 1b just switched it on to protect the log, silently undoes
that protection mid-reflection. `traits` and `topics` default to `[]` the same
way, so omitting them empties them.

Note the third column: `external_reflection_only` is **absent** from the
record when it has never been set, not present-and-`false`. Test it as
`(.external_reflection_only // false)`; a bare truthiness check on a missing
key is fine, but a `== false` check is not.

Round-trip the whole record and none of this can happen. Hand-type a payload
and it will.

### Server-managed fields

`pending_update` and other server-managed fields are dropped from the
persisted record on every `persona` update, whether or not your payload
mentions them. This is deliberate and it is how this skill resolves a stale
critic proposal without a separate "dismiss" verb — see `../lenses/persona.md`.

**"Every" includes the preflight opt-out write.** `../SKILL.md` Step 1b may
set `external_reflection_only: true` before either lens runs, and that write
destroys `pending_update` exactly like any other. So Step 1b captures the
proposal **before** it writes, and the Persona lens consumes that capture
rather than a fresh read. If you are changing the preflight, preserve that
ordering: a read that must *precede* a write is not the same as a read you can
redo afterwards.

## Passing JSON safely

Descriptions are prose-heavy and routinely contain apostrophes and quotes that
will break shell quoting. **Do not hand-type the JSON into a single-quoted
string, and do not open an editor** — no path in this skill may require
`$EDITOR`.

```bash
EDIT_JSON=$(mktemp)
# write the edited record to "$EDIT_JSON" with your own file-writing tool
ei update persona "$PERSONA_ID" --json "$(cat "$EDIT_JSON")"
rm -f "$EDIT_JSON"
```

`mktemp` rather than a predictable `/tmp/persona-edit.json`: these payloads
carry the full persona identity and the full person log.

Or use a scripting runtime: read the record, mutate the object,
`JSON.stringify`, pass the result as one interpolated argument. Never
hand-retype a record from memory — fetch it and mutate it, or you will drop a
field.

## Clearing the PersonLog

Only ever from `../SKILL.md` Step 6, only after the joint gate passes.

```bash
ei --id "$PERSON_LOG_ID"        # fresh read — NOT the Step 2 copy
```

Take that full record, set `description` to `""`, leave every other field
exactly as read (`name`, `relationship`, `sentiment`, `identifiers`,
`sources`, …), and write it back with the same safe-JSON pattern:

```bash
LOG_JSON=$(mktemp)
# write the record above, with description set to "", to "$LOG_JSON"
ei update person "$PERSON_LOG_ID" --json "$(cat "$LOG_JSON")"
rm -f "$LOG_JSON"
```

Then `ei --id "$PERSON_LOG_ID"` and confirm `description` is `""`.

`linked_quotes` appears when you read a person but is a derived projection —
it is not a writable field. Send back what you read for everything else; drop
`linked_quotes` from the payload if the schema rejects it, and never treat its
absence from your payload as deleting quotes.

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
