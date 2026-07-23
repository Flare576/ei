# reference: the bookkeeping — get this exactly right

Everything in this file is mechanical, not judgment. Get the judgment calls
right (`contracts.md`, `recon.md`) and then get *these* exactly right too —
skip them and the automatic Rewrite ceremony will immediately re-flag your
manual edit, or a later rewrite pass will silently drop a persona's access to
a record it should still see.

This mirrors what `src/core/handlers/rewrite.ts` (`handleRewriteRewrite`)
actually does when the ceremony runs. You're doing its job by hand — do its
bookkeeping too.

---

## 1. `rewrite_length_floor` — set it on every record you touch

**Formula:** `Math.max(750, Math.ceil(description.length * 1.1))`

Set this field, recomputed from the record's **final** description length,
on:
- Every existing record you update (whether it's a fold-in target or the
  slimmed original) — recompute from its new, post-edit description.
- Every new record you create — computed from its initial description.
- The original bloated record, **last**, after it's been slimmed — recompute
  from its new (shorter) description, not its original length.

**Why 750 and `* 1.1`, not just the raw length:** the floor exists to stop
the ceremony from immediately re-scanning a record that hasn't meaningfully
grown since its last review. 750 is a minimum so tiny records aren't
re-flagged over trivial edits; `* 1.1` gives ~10% headroom so the *next*
review only triggers once the description has genuinely grown again, not on
every single-sentence addition.

`rewrite_length_floor` is a real, optional field on `Person` and `Topic`
alike (it lives on the shared `DataItemBase` type) — the `ei` CLI accepts and
returns it identically for both. It's easy to assume it's Topic-only because
older docs only mentioned it there; it isn't.

## 2. `persona_groups` / `interested_personas` — union, not overwrite

When you redistribute content out of a record into other records (existing
or new), every record **involved in that one rewrite operation** — the
original plus every existing record you're folding content into — should end
up sharing the **union** of their `persona_groups` and `interested_personas`.
Concretely:

1. Collect every record involved in this rewrite: the original bloated
   record, plus every *existing* record you're updating as a redistribution
   target (not records you're merely rejecting as false matches).
2. Union their `persona_groups` arrays (dedupe).
3. Union their `interested_personas` arrays (dedupe).
4. Apply that same unioned pair to **every brand-new record you create** in
   this batch.
5. **Existing** records you update keep their *own* existing
   `persona_groups`/`interested_personas` untouched, unless you're
   deliberately widening them — don't shrink an existing record's visibility
   as a side effect of an unrelated rewrite.

This matters because `persona_groups` gates which personas can even see a
record. If Abinet's Person record is visible to the `Integrations`/`Pi`
persona group and you spin off a new "Critique Crews" Topic without carrying
that forward, the personas who actually talked about Critique Crews with the
user lose visibility into a topic that came directly from their own
conversation history.

## 3. Required shape for every record you write

### Updating an existing record (fold-in target, or the slimmed original)
Full-record round-trip as always (`references/cli.md`) — read it, change
only these fields, write the whole thing back:
- `description` — the updated/slimmed text.
- `sentiment` — keep as-is unless the redistribution genuinely changes it.
- `rewrite_length_floor` — recompute per §1, from the **new** description.
- (Topic only) `category` — preserve unless you have a specific reason to
  change it.
- (Person only) `relationship` — preserve unless you have a specific reason
  to change it.

### Creating a new Topic
```json
{
  "name": "Subject Name",
  "description": "Content redistributed from the original record.",
  "sentiment": 0.5,
  "category": "Technical|Project|Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Event",
  "persona_groups": ["<unioned groups>"],
  "interested_personas": ["<unioned persona ids>"],
  "rewrite_length_floor": 750
}
```
- `category` — pick the best fit; when unsure and the content came from a
  Technical-category source, inherit `"Technical"` rather than guessing.
- `exposure_current`/`exposure_desired` — leave at defaults (0.5/0.5) unless
  you have a real reason to set otherwise; this mirrors the ceremony's own
  defaults for freshly split-off content.

### Creating a new Person
```json
{
  "name": "Person Name",
  "description": "Content redistributed from the original record.",
  "sentiment": 0.0,
  "relationship": "coworker",
  "identifiers": [],
  "persona_groups": ["<unioned groups>"],
  "interested_personas": ["<unioned persona ids>"],
  "rewrite_length_floor": 750
}
```
- `identifiers` — start empty unless the redistributed content itself
  contains a real identifier (a name, handle, etc.) worth recording; don't
  invent one.
- `relationship` — required; if genuinely unclear from the redistributed
  content, use `"Unknown"` and flag it to the user rather than guessing at a
  specific relationship.
- Leave `learned_by`/`learned_on` unset unless you have a real value for
  them (a persona UUID you're acting as, an actual timestamp) — don't invent
  a placeholder value for either.

## 4. Order of operations

1. Redistribute first: create/update every target record (existing or new)
   that's receiving content. **After each individual write, re-read that
   record** (`ei --id <id>`) to confirm it landed as sent.
2. **On any write failure, or a re-read that doesn't match what you sent,
   stop the entire sequence immediately.** Do not proceed to the remaining
   targets, and do not touch the original record. Report exactly which
   targets landed and which didn't, then repair and re-confirm the plan
   with the user before resuming — never continue from a prebuilt batch of
   writes as if the failure didn't happen. This is what actually makes
   "targets-first, original-last" a safety property rather than just an
   ordering preference.
3. Slim and re-float the original **last** — only once every piece of its
   content has a confirmed, verified home. If you slim the original before
   the targets are confirmed, a failure partway through leaves content
   orphaned nowhere.
4. Recompute the original's own `rewrite_length_floor` from its final,
   post-slim description length as the very last write.
