# reference: the bookkeeping — get this exactly right

Everything in this file is mechanical, not judgment. Get the judgment calls
right (`contracts.md`, `recon.md`) and then get *these* exactly right too.

This mirrors what `src/core/handlers/rewrite.ts` (`handleRewriteRewrite`)
actually does when the ceremony runs — with one now-important difference:
this skill USED to also hand-maintain two fields the ceremony sets
server-side (`rewrite_length_floor`, `persona_groups`/`interested_personas`
union), because the old CLI/MCP contract accepted them on write. It no
longer does — ADR-031 made both System Hidden/System Visible, so neither is
part of the writable surface anymore, for `create` or `update`. §1 and §2
below explain the resulting gap explicitly; don't skip them assuming they're
just historical color.

---

## 1. `rewrite_length_floor` — you can no longer set it; know what that means

**This field left the external write contract entirely (ADR-031).** There is
no JSON field, on `create` or `update`, that touches it anymore — submitting
one is rejected as an unrecognized key. You cannot recompute it by hand the
way this skill used to.

**The consequence, stated plainly:** `update` is a merge patch now
(RFC 7396, ADR-029) — a field you don't send is left exactly as it was. Since
you can never send `rewrite_length_floor`, every record you touch through
this skill keeps whatever floor it already had, **unconditionally**,
regardless of how much its description just grew or shrank. That is an
accepted **interim** state (ADR-032's own explicitly-rejected "Alternative
D" — permanent preservation, never re-evaluated), not a bug this skill
should try to work around:
- It's better than the pre-merge-patch bug (an old floor being wiped and the
  record immediately spuriously re-flagged).
- It's worse than the ceremony's own intended behavior (recompute on grow,
  preserve on shrink) — a held-back fix replaces this interim state later;
  this skill has no way to implement that recompute itself anymore.

**What this means for you, concretely:** don't attempt to set or reason
about `rewrite_length_floor` at all. You cannot make it more correct than
whatever it already was. If a record you touch gets re-flagged by the
ceremony sooner or later than you'd expect afterward, that's this accepted
interim state, not something you did wrong.

## 2. `persona_groups` / `interested_personas` — you can no longer manage them either

**Also gone from the external write contract (ADR-031, System Visible —
provenance is never caller-assertable).** You can still *read* them (they
appear on `ei --id` output), but there is no way to set, union, or widen
them through `create`/`update` anymore.

**This is a real capability loss for this skill, not just a bookkeeping
change.** Redistributing content out of an over-broad record used to let you
carry forward which persona groups could see it; now a brand-new record you
create starts with whatever the system defaults to, and an existing target
you fold content into keeps its own existing visibility untouched — with no
way for you to widen either, even when the redistributed content clearly
came from a persona group that can no longer see where it landed.

**What this means for you, concretely:**
- Do the redistribution itself exactly as before (recon, splitting content,
  choosing homes) — that judgment is unaffected.
- Do NOT attempt to include `persona_groups`/`interested_personas` in any
  write — they're rejected, not silently ignored, so trying will fail the
  whole write.
- **Tell the user explicitly** when a redistribution moves content that a
  persona group could see into a record that group might not be able to see
  anymore (or a new record with only system-default visibility). This is a
  known, disclosed gap in what this skill can guarantee now — don't paper
  over it by pretending the old union behavior still happens.

## 3. Required shape for every record you write

### Updating an existing record (fold-in target, or the slimmed original)
A merge patch (`references/cli.md`) — read for context, send only the
field(s) actually changing:
- `description` — the updated/slimmed text.
- `sentiment` — only if the redistribution genuinely changes it; otherwise
  omit it, it's already unchanged.
- (Topic only) `category` — only if you have a specific reason to change it;
  otherwise omit it.
- (Person only) `relationship` — only if you have a specific reason to
  change it; otherwise omit it.

### Creating a new Topic
```json
{
  "name": "Subject Name",
  "description": "Content redistributed from the original record.",
  "sentiment": 0.5,
  "category": "Technical|Project|Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Event"
}
```
- `category` — pick the best fit; when unsure and the content came from a
  Technical-category source, inherit `"Technical"` rather than guessing.
- `exposure_current`/`exposure_desired` are no longer part of this payload at
  all (ADR-031) — the system sets neutral defaults for a freshly created
  Topic; there is nothing for you to specify.

### Creating a new Person
```json
{
  "name": "Person Name",
  "description": "Content redistributed from the original record.",
  "sentiment": 0.0,
  "relationship": "coworker",
  "identifiers": []
}
```
- `identifiers` — start empty unless the redistributed content itself
  contains a real identifier (a name, handle, etc.) worth recording; don't
  invent one.
- `relationship` — required; if genuinely unclear from the redistributed
  content, use `"Unknown"` and flag it to the user rather than guessing at a
  specific relationship.
- Leave `learned_by`/`learned_on` unset — they're no longer part of this
  payload at all (ADR-031, provenance is never caller-assertable); there is
  nothing for you to specify even if you had a real value in mind.

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
3. Slim the original **last** — only once every piece of its content has a
   confirmed, verified home. If you slim the original before the targets
   are confirmed, a failure partway through leaves content orphaned
   nowhere. Send only `description` (the slimmed text) in this patch —
   there is no floor to recompute anymore (§1).
