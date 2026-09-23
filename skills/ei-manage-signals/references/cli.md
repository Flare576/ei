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
ei --id <id>                        # full record for one entity (persona, person, signal, …)
ei person -n <N>                    # browse people, most-recently-mentioned first
ei list signals <personaId>         # every EmergentSignal on this persona, both lenses, every status
```

`ei --id` on a **persona** returns the `PersonaEntity` shape only —
`display_name`, `short_description`, `long_description`, `traits`,
`topics`. It does **not** include `observations` or `signals` — those live
in a separate collection this lookup never projects. `ei list signals
<personaId>` is the only CLI read path for signals; **there is no CLI read
path for raw observations at all**, even though they exist independently in
storage as soon as `ei add observation` records one — Match hasn't
necessarily created or attached a signal citing it yet (→ "Assert a
brand-new observation" below). Once Match does run, the resulting signal's
`evidence_ids` references it, and that's the only way this skill ever sees
it again — not because it exists solely as evidence, but because a signal's
`evidence_ids` is the only surfaced pointer to it.
`ei --id` on a **person**
also returns `linked_quotes`; this skill has no reason to read a linked
Person record at all except to find its `id` for `ei add observation`'s
`subject_person_id` field (`../SKILL.md` Step 1b) — see that step for why.

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

`../SKILL.md` Step 1b needs the Person record's id for `ei add observation`'s
`subject_person_id` field. Enumerate every match rather than trusting a
first one: a wrong id here misattributes a brand-new observation to the
wrong person, permanently.

### Why not `--identifier`

```bash
ei --identifier "Ei Persona" "$PERSONA_ID"   # ← returns ONE record. Don't use it here.
```

`--identifier` matches the **first** person whose identifier array contains
that value. The CLI's own documentation concedes the result is arbitrary when
the identifier isn't unique under its type. `Ei Persona` is *meant* to be
unique — one Persona id per persona — but the case this check exists for is exactly
the case where that assumption has already broken, and nothing catches a bad
pick after the fact. That is exactly why this skill enumerates every linked
record itself instead of trusting a first match: a first-match pick here can
silently misattribute a new observation, with nothing else in the system
positioned to notice.

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
| exactly 1 | Note its `id` as `$LINKED_PERSON_ID`. You can now assert new observations this run. |
| more than 1 | **Stop and ask the user which one actually represents them.** Show the names and `chars`. Never pick. This is usually a real identifier problem — `ei-curate` fixes it. Not a blocker for the rest of the run: you can still resolve every open signal, you just can't assert a *new* observation until this is fixed. |
| 0 | No Person record is linked to this persona yet. Same: resolve open signals normally, skip new-observation assertion this run. |

---

## Reading and resolving signals

### List every signal

```bash
SIGNALS_JSON=$(mktemp)
ei list signals "$PERSONA_ID" > "$SIGNALS_JSON"
```

Returns a flat array, every signal on the persona, every status, both
lenses tagged in each entry's own `lens` field. Capture it to a file once —
`../SKILL.md` Step 2 relies on this being ONE snapshot both lenses read,
not a command you re-run per lens. Filter the captured file, don't
re-invoke the CLI to re-sort or re-classify:

```bash
# Open (actionable) signals, split by lens:
jq '[.[] | select(.status == "candidate" or .status == "recurring")]' "$SIGNALS_JSON"
```

`reviewed`, `dismissed`, and `superseded` signals are already resolved —
this skill has no reason to touch them again. A `dismissed` signal can
reopen on its own later (a new candidate citing it via
`supersedes_signal_id`) if genuinely new evidence in a different context
arrives; nothing in this skill does that directly.

### Resolve one signal: confirm or dismiss

```bash
ei confirm signal <personaId> <signalId> --json '{"actor":"'"$PERSONA_ID"'"}'
ei dismiss signal <personaId> <signalId> --json '{"actor":"'"$PERSONA_ID"'"}'
```

Both require `actor` — a self-attested string identifying who reviewed
this; Ei does not independently verify it. Use `$PERSONA_ID`
(`../SKILL.md` Step 1a), never the display name — this is exactly the
"key on ids, treat names as prose" rule applied to a new field, not an
exception to it: a display name is unvalidated, user-controlled text that
can contain quotes or shell metacharacters, and this skill never puts one
on a command line in any form, `--json` included.

**Neither call accepts a `delta` — not as an argument, not for either
lens, not from any caller.** There is no staging step anymore: an earlier
design let `confirm` accept an optional `delta` that created a
`pending_update` proposal a *separate* review pass then had to apply.
That mechanism is retired outright, not merely unused. `signal.confirm`/
`signal.dismiss` are pure status-transition bookkeeping now — `status`,
`reviewed_by`/`dismissed_by`, nothing else — for both the Persona lens and
the Agent lens alike. If the signal implies an identity change, make that
change first, directly, through `ei update persona` (below) — then call
`confirm` bare, exactly as shown above. Supplying a `delta`-shaped field
here is rejected outright, the same way any other unrecognized field is.

`confirm`/`dismiss` only accept `candidate` or `recurring` signals — calling
either on one already `reviewed`, `dismissed`, or `superseded` is refused,
no state change.

**There is no "leave it open" command, because there doesn't need to be
one.** An open signal you call neither `confirm` nor `dismiss` on this run
simply stays `candidate`/`recurring` — the next `ei list signals` shows it
again, exactly as it is now. That is a normal, safe outcome, not a retry
you have to engineer.

### Assert a brand-new observation

Only when the conversation surfaces something not already covered by an
open signal, and only when Step 1b found exactly one `$LINKED_PERSON_ID`:

```bash
ei add observation "$PERSONA_ID" --json '{
  "subject_person_id": "'"$LINKED_PERSON_ID"'",
  "observer_kind": "subject_self",
  "dimension": "behavior",
  "direction": "novel",
  "claim": "Consistently terse in status updates.",
  "lens": "persona"
}'
```

`observer_kind` is `"human"` when the live user is the one asserting it,
`"subject_self"` when you are (you're reflecting on yourself, so this is
the common case), or `"other_persona"` (requires `observer_persona_id` too)
if you're relaying another persona's testimony from this same conversation.
`dimension` is one of `behavior`/`voice`/`values`/`relationship`/`identity`;
`direction` is `novel`/`confirms`/`challenges`.

**`lens` here is YOUR OWN assertion, not a verified classification.** An
extraction-produced signal was lens-tagged by `classifyObservationLens`
from actual execution provenance — but a signal you're reading in `ei list
signals` right now could instead trace back to an *earlier* `ei add
observation` call from a past run, and there is no field on a signal that
tells you which kind you're looking at. Treat any agent-lens signal's
classification as worth a quick gut check against its `claim`, not an
ironclad guarantee, the same caution this note is asking you to apply to
the one you're about to mint yourself. Pick `persona` for identity
material, `agent` for operating-contract material, the same test Step 3 of
each lens already applies to everything else — but say so if you relay
this signal's disposition to the user later: it's caller-asserted
evidence, not extraction-verified evidence, and a future audit of *why*
something landed in the agent lens should be able to tell the two apart.

**This does not synchronously produce a resolvable signal — plan for a
later run, not this one.** `ei add observation` only persists the
observation itself. It queues a *separate* Match request that an LLM has
to actually answer before any signal is created or corroborated — the same
asynchronous queue every other extraction-produced signal in this codebase
goes through, not something this CLI call resolves inline. Concretely:

- If Ei is running live, that Match request joins its normal processing
  queue and resolves on the live Processor's own timing — seconds to
  minutes later, not before this script's next line runs.
- If Ei is NOT running live (the common case for a by-hand CLI run — see
  `../SKILL.md` Step 0), the observation self-drains into `state.json`,
  but the Match request it queued has nobody to process it until an Ei
  instance actually launches and its queue-processor runs. There is no
  signal to find at all until then.

**So: tell the user what you did, and that its disposition is a future
run's job.** Report the outcome exactly as the response said it —
`"recorded"` means it applied now; `"queued"` means it was captured for
later drain, not validated or guaranteed to succeed yet. Either way, say
plainly that its Match/signal step hasn't happened and can't be forced
from here. Do not poll `ei list signals` in a loop waiting for it, do not
claim it "should be there now," and do not treat its absence from a fresh
`ei list signals` read as an error. The next time this skill runs — once
enough time or an Ei launch has let the queue actually process — a new or
corroborated signal citing this observation (via `evidence_ids`) will show
up as open, exactly like any extraction-produced one, and gets confirmed
or dismissed the same way.

---

## Writing identity — a merge patch

```bash
ei update persona <persona-id> --json-file <path>
```

This skill never writes a Person record — the linked Person's `description`
is not part of this process (`../SKILL.md` → "Your linked Person record"),
and every other Person field is out of scope for managing your own signals.
`ei update person` still exists as a general CLI command; it just has no
use inside this skill.

**`update` is RFC 7396 JSON Merge Patch.** Send only the field(s) you
mean to change. Anything you omit is left completely unchanged. The one
exception is `traits`/`topics`: if you send either array at all, it
replaces the array wholesale — there is no per-element edit on this path
for a CLI/MCP caller (that capability exists only for a Native persona's
own dedicated tool set, `edit_trait`/`edit_topic`, which this skill's
audience does not use).

1. `ei --id <id>` → read the current record, for context and for the
   diff-check below — not because you need to resend it.
2. Build a small JSON object containing ONLY the field(s) you mean to
   change.
3. Send just that.

**Still re-read immediately before writing**, and diff against your earlier
read — only the fields your patch touches, not every field on the record.
Reflection conversations take real time; if a field you're ABOUT TO
CHANGE moved in that window, stop and re-confirm with the user before
overwriting it. This still matters even with a narrow diff, because a
patch and a concurrent edit to the *same* field can still race.

Ei recomputes the embedding automatically on every update.

### Server-managed fields

Every field NOT in the edited set survives an update untouched. Genuinely
system-owned fields (`id`, `last_updated`, `description_embedding`,
`is_static`, `last_heartbeat`, `observations`, `signals`) are never yours
to set directly; sending them back (e.g. echoed from an `ei --id` read) is
harmless — they're silently ignored, not rejected — but you never need to
include them at all. `observations`/`signals` change only through
`ei add observation`/`ei confirm signal`/`ei dismiss signal` above, never
through `ei update persona`.

## Passing JSON safely

Descriptions are prose-heavy and routinely contain apostrophes and quotes
that will break shell quoting. **Do not hand-type the JSON into a
single-quoted string, and do not open an editor** — no path in this skill
may require `$EDITOR`.

```bash
EDIT_JSON=$(mktemp)
# write ONLY the changed field(s) — e.g. {"traits":[...]} or
# {"short_description":"..."} — to "$EDIT_JSON" with your own file-writing tool
ei update persona "$PERSONA_ID" --json-file "$EDIT_JSON"
rm -f "$EDIT_JSON"
```

`--json-file <path>` (not `--json "$(cat ...)"`) is this skill's preferred
write mode — it takes the exact same body from a file instead of putting it
on argv, which matters here specifically: these payloads can carry the full
persona identity, the most sensitive write in this codebase. `mktemp` rather
than a predictable `/tmp/persona-edit.json` for the same reason `--json-file`
exists — don't leave the file at a guessable path either.

Or use a scripting runtime: build the patch object, `JSON.stringify`, pass
the result as one interpolated argument to `--json`. Either way, never
hand-retype JSON from memory.

## There is no undo

Every write is an append-only correction. A mistake is fixed with *another*
write where one exists — but not every write has one. An observation, once
added, is permanent — there is no "un-add." **A signal's `confirm`/
`dismiss` has no correction path either**: `signal.confirm`/`signal.dismiss`
only accept a `candidate`/`recurring` signal — calling either again on the
`reviewed`/`dismissed` result is refused, no state change (→ "Resolve one
signal" above). Get the disposition right before you call it; there is
nothing to undo it with afterward. An identity field, by contrast, CAN be
corrected with another `ei update persona` patch — that write is a normal
merge patch, not a terminal transition.

`cat`-ing `corrections.json` is not a reliable way to confirm a write landed.
Which path a correction takes depends on two conditions, not one:

| Live Ei running? | Local `state.json` present? | What happens |
|---|---|---|
| yes | either | **Queued** — a live instance typically drains it within ~100ms, but that is not a guarantee this skill can wait out |
| no | yes | **Self-drains directly** into state; the queue file is left empty |
| no | no (only `state.backup.json`) | **Queued** for the *next launch* to drain — no timeline at all within this conversation |
| no | neither | Error — no Ei data at this `EI_DATA_PATH` |

**How you check depends on which command you called, because they don't
all expose the same thing:**

- **`ei add observation` / `ei confirm signal` / `ei dismiss signal`** —
  their own JSON response tells you outright. `{"status":"recorded",...}`
  means it applied right now, full stop, nothing further to check.
  `{"status":"queued"}` means it has NOT applied yet — report it to the
  user as queued and unconfirmed, exactly that, and stop there. Do not
  follow up with `ei list signals` to "check" whether a queued write has
  landed; a mismatch there proves nothing (it may simply not have drained
  yet) and a match there proves nothing either (it may be leftover prior
  state that happens to look right).
- **`ei update persona`** — the identity-write command does NOT expose
  which branch it took at all; its response has no `status`/drain-mode
  field to read. A follow-up `ei --id` therefore cannot cleanly distinguish
  "still queued" from "genuinely failed" the way the commands above can.
  **A mismatch here is inconclusive, not evidence of failure** — do not
  wait-and-retry into a `blocked` verdict. Reserve `blocked` for an
  explicit CLI-level failure only (non-zero exit, an error printed to
  stderr, a validation message). If the read-back happens to match, that's
  good corroborating evidence; if it doesn't, say plainly that the write
  may still be in flight (if Ei is running live) or waiting for a future
  launch (if this machine only has a backup) and that you cannot tell
  which from here — never assert it failed on the strength of a mismatch
  alone.

You never need to stop Ei to run this skill.
