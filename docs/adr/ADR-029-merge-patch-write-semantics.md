# ADR-029: External Writes Are JSON Merge Patch, Not Full-Record Replacement

## Status

Accepted

## Date

2026-08-03

## Context

`ei create` / `ei update` and their MCP equivalents are **full-record replacements**. The Zod schemas
behind them apply defaults on omission, so a caller that leaves a field out does not leave it
unchanged — it resets it, silently, with a success exit.

An inventory found **14 such fields across 5 entity types in 3 files**:

| Entity | Field | Default | Effect of omission |
|---|---|---|---|
| Persona | `traits` | `[]` | **erases the entire personality** |
| Persona | `topics` | `[]` | erases every topic interest |
| Persona | `external_reflection_only` | `false` | PersonLog consumed on next ceremony |
| Persona | `is_paused` | `false` | silently un-pauses |
| Persona | `is_archived` | `false` | silently un-archives |
| Person | `relationship` | `''` | erases the relationship |
| Person | `exposure_current` / `exposure_desired` | `0` / `0.5` | resets what Ei chooses to discuss |
| Topic | `exposure_current` / `exposure_desired` | `0` / `0.5` | same |
| Fact | — | none | unaffected |
| Quote | — | none | unaffected; its four ops are partial by construction |

Sources: `src/cli/persona-corrections.ts:50-90`, `src/cli/corrections-endpoints.ts:104-154`.

`ei update persona` omitting `traits` deletes the persona's personality. For a system whose premise is
persistent identity, that is the sharpest failure available, and it is reachable by a well-behaved
caller — an agent that constructs a record from anything less than the full entity, or that predates a
field's existence.

This is the **fourth** appearance of one shape. `preserveHiddenToolGrants()`
(`src/core/persona-tools.ts`) exists because a disabled provider's tools are invisible to an editing
surface, so a faithful full-record edit revoked grants the editor could not see. ADR-007 recorded the
same hazard for `external_reflection_only` and could only mitigate it with an instruction: *"Any new
editing surface must round-trip the field explicitly."* GitHub #96 is the same shape again, via aliases.
Each was patched per-field. The pattern is not converging.

**TUI and web are not affected.** `Processor.updatePersona`, `updateHuman`, and `updateQuote` all take
`Partial<>` and spread, so in-process edits already behave as patches. Only the CLI/MCP path replaces
whole records — meaning the exposed population is precisely the external writers: agents, shipped
skills, and `ei update`.

## Decision

**External writes use JSON Merge Patch semantics, as specified by RFC 7396**, uniformly across persona,
person, and topic. Fact needs no change (no defaults) and quotes keep their four dedicated ops.

| RFC 7396 rule | Meaning here |
|---|---|
| Member absent from the patch | Leave the stored value unchanged |
| Member present with a value | Set it to that value — `traits: []` genuinely means "empty the array" |
| Member present as `null` | Remove the member |
| Arrays | Replaced wholesale, never merged element-wise |

Adopting the RFC by name is deliberate. Shipped skills can state *"`ei update` is JSON Merge Patch
(RFC 7396)"* and any competent agent reading them already knows the rules, instead of inferring a
bespoke contract from prose we wrote.

**1. The merge happens at drain time, against live state.**

Not at write time against a snapshot. A write-time merge would read current state, materialise a full
record, and queue that — which reintroduces ADR-008's Race 2 in full, because the materialised record
carries every field from a snapshot that may be seconds stale.

**2. All three correction-apply paths share one merge function.**

There are **three**, not two, and the codebase documents its own surface at `src/core/corrections.ts:238-241`:
`applyCorrectionToHuman`, `applyCorrectionToState`, and `Processor.applyCorrectionRecord`.

| Path | Location | Reached by |
|---|---|---|
| Live drain | `Processor.applyCorrectionRecord` — `src/core/processor.ts:822` | a running TUI, called from `:788` |
| State apply | `applyCorrectionToState`, wrapped by `applyCorrectionsToState` — `src/core/corrections.ts:724` | the CLI read overlay (`src/cli/retrieval.ts:70`) **and** the self-drain (`src/cli/corrections-writer.ts:157`) |
| Human apply | `applyCorrectionToHuman` — `src/core/corrections.ts` | the CLI read-merge path |

The overlay exists so a CLI read reflects its own pending write immediately. Once a correction is a *patch*
rather than a record, every path must apply it **identically**, or a read and the eventual write disagree
about what the queued correction means. One function, three callers.

**This hazard is not hypothetical — it already exists in this code.** `src/core/corrections.ts:475-478`
states plainly: *"Live's Processor already enforces this (`applyCorrectionRecord`); this is the equivalent
guard for the CLI read-merge and self-drain paths."* That is two implementations of one rule, maintained in
parallel by hand, which is exactly the divergence this clause exists to prevent from recurring with merge
semantics. Consolidate rather than add a third parallel implementation.

**3. Merge is non-mutating; validation is whole-candidate over the writable projection; the write is single.**

The pipeline is fixed: derive a **fresh candidate** by merging the patch onto a copy, validate the candidate's
**externally-writable projection** against that entity's input schema, then perform exactly one replace. Never
mutate the stored entity while deriving or validating it.

This matters because full replacement got all-or-nothing behaviour for free — the input schema rejected a
bad body before anything was constructed. Merging does not: a patch can be individually well-formed and
still produce an invalid entity after application (for example, removing a required persisted member
alongside a valid change). Validating the patch in isolation cannot catch that.

**Corrected 2026-08-04.** This clause originally read *"validate the **complete candidate** against the full
entity schema."* Beta rejected that as unimplementable, and was right: there is no schema for any entity type
whose inferred type is the entity. Every schema infers a narrower input type, by the codebase's own `XInput`
naming convention. But the diagnosis was incomplete, and the precise version determines the fix:

**The problem is not that no suitable schema exists — it is that the suitable schema is `strict`.** One schema
governs each entity type, with no create/update split: `factSchema` (`src/cli/corrections-endpoints.ts:91`),
`topicSchema` (`:99`), `personSchema` (`:116`), `personaEntitySchema` (`src/cli/persona-corrections.ts:106`).
Each already carries the required/optional distinction whole-candidate validation needs — `factSchema.name`,
`.description`, and `.sentiment` are all non-optional, so a candidate missing one is rejected.

Each is also a **`z.strictObject`**, which rejects unrecognised keys. A candidate is the patch merged onto the
*stored record*, so it necessarily carries `id`, `last_updated`, `embedding`, `learned_by`,
`interested_personas` and other system-owned members that these schemas never declare. Handing a whole
candidate to a strict schema therefore fails on unknown keys **every time, for every entity type** — not
because the candidate is invalid, but because the schema was only ever meant to describe caller input.

**Therefore the validation target is the candidate's projection onto the schema's own declared keys.**

**ADR-031 is what makes that sufficient rather than a compromise**, and this clause depends on it. Under
ADR-031's field-visibility model, any field outside the input schema is System Visible or System Hidden —
which means **an external patch cannot reach it, so a merge cannot break it.** There is no invariant the
projection fails to protect, because the fields it omits are exactly the fields no caller can touch. Validating
the projection is complete coverage of the reachable surface, not a narrowed check.

Two implementation consequences follow, and both are load-bearing:

- **The patch parse and the candidate validation need different schemas derived from one declaration.** The
  patch must be parsed permissively — a patch supplying only `sentiment` is legitimate, so the parse uses the
  schema's partial form. The candidate must be validated strictly on required members, so it uses the full
  form. Deriving both from the same declaration is what keeps them from drifting; maintaining two hand-written
  schemas per entity would reintroduce the duplicate-enforcement hazard clause 2 exists to prevent.
- **`tools` must leave the persona input schema for this to hold.** It is currently declared there as a nested
  `Record<string, Record<string, boolean>>` (`src/cli/persona-corrections.ts:125`) while `PersonaEntity.tools`
  is a flat `string[]` — the single widest schema-vs-entity divergence in the codebase, and the reason Beta's
  original objection had teeth. ADR-031 resolves it by classifying `tools` as System Hidden, removing it from
  the external contract entirely. **Until that lands, persona merge-patch has a field whose projection cannot
  round-trip**, and item 02 must not claim otherwise.

**Implementation note, 2026-08-07.** Two findings from the actual build, recorded here rather than left to
drift out of memory:

- **The patch/candidate schema pair is now derived from one shared module** used by both the CLI parser and
  core validation, rather than two hand-maintained schemas per entity. This closes the exact drift risk this
  clause warns about — the two representations had already begun to diverge in practice by the time this was
  caught during implementation review, before any external caller could observe it.
- **A real drain-time-clobber bug surfaced and was fixed**, in the same class this ADR's clause 1 exists to
  prevent: a caller's merge patch could carry an embedding vector computed at write time, and if the record
  changed again before the patch drained, that stale embedding would overwrite a newer one. The fix is that
  embeddings are never trusted from the wire — they are recomputed at actual drain time, against live state,
  same as the merge itself. Worth naming explicitly because it is easy to satisfy "merge at drain time" for
  the fields a reviewer is thinking about while missing a field, like a derived embedding, that quietly rode
  along on the patch.

**4. `create` and `update` are different operations and must stop sharing one body contract.**

`applyMergePatch(current, patch)` requires an existing record, so it has no meaning for `create`. Today both
share `buildAndWriteUpsert` (`src/cli/corrections-endpoints.ts:308-389`) and the generic `CorrectionUpsert`
carries no create-vs-update intent (`src/core/corrections.ts:40-46`). Persona creation *and* update both call
`materializeTraits(parsed.traits, now)` (`src/cli/persona-corrections.ts:307`, `:389`), which does
`traits.map(...)` — so making `traits` optional throws on `undefined` in **both** paths.

Therefore: **`create` keeps full-body required/defaulted semantics** (it is constructing a whole record and
has nothing to merge into), while **`update` parses a patch**. The correction representation must carry that
intent so the apply paths can tell them apart.

**5. `pending_update` is clearable but not settable.**

It becomes a legal patch member accepting **only `null`** (RFC 7396 remove). Non-null content is
rejected.

Clearing it must be expressible, because clearing it was previously the *only* reason to send a full
record, and #97 — which would give it a real lifecycle — is not in this release. But `pending_update`
is **Critic output**: a proposed identity revision the user reviews. A caller that could write
arbitrary content into it could fabricate a reflection proposal that appears in the review UI as though
Ei's own Critic produced it. ADR-014 spent its entire argument narrowing what a caller may assert about
provenance; opening this would contradict it for no gain.

## Alternatives Considered

### Alternative A: Keep full-record replacement, add a preserve-on-omit list
- **Description**: Generalise `preserveHiddenToolGrants` into a list of fields where absence means "unchanged."
- **Pros**: Incremental. Matches existing precedent exactly. No contract change, no skill rewrite.
- **Cons**: Requires remembering to add every future field to the list. The hazard has appeared four
  times and been patched per-field four times; a fifth mechanism of the same kind predicts a fifth
  appearance. It also leaves the semantics *implicit* — a caller cannot tell from the contract which
  fields are preserved and which reset.
- **Why not chosen**: it makes correctness depend on vigilance, indefinitely.

### Alternative B: Do nothing; document the requirement harder
- **Description**: ADR-007's approach — instruct every editing surface to round-trip every field.
- **Pros**: Zero code change.
- **Cons**: Already tried. ADR-007 issued exactly this instruction on 2026-08-01 and the field it was
  protecting still carries the hazard today. An instruction is not an invariant.
- **Why not chosen**: the evidence against it is this ADR's own context section.

### Alternative C: Schema-level omitted-vs-explicit-false only
- **Description**: Make `.default(false)` apply on create but not update, leaving replacement semantics otherwise intact.
- **Pros**: Narrow. Fixes the booleans.
- **Cons**: Fixes only scalars with defaults. `traits: []` is the most destructive case and this does not
  address it, because an omitted array under replacement semantics is still an empty array.
- **Why not chosen**: it solves the mild half of the problem and leaves the severe half.

### Alternative D: Merge at write time
- **Description**: Read current state, apply the patch, queue a complete record.
- **Pros**: The drain stays unchanged. Corrections remain uniform full records.
- **Cons**: Reintroduces ADR-008 Race 2 at full width — the queued record carries a stale snapshot of
  every field, so any concurrent edit is clobbered even for fields the caller never mentioned.
- **Why not chosen**: it converts a targeted write into a whole-record write, which is the defect.

## Consequences

### Positive

- The destructive case becomes unreachable. Omitting a field cannot delete data.
- **Backward-compatible for correct callers.** A faithful `ei --id` → edit → `ei update` round trip omits
  nothing, so its behaviour is identical. The only intentional user of reset-on-omission was
  `pending_update` clearing, which now has an explicit mechanism. Behaviour changes only in the buggy case.
- **ADR-008's Race 2 narrows.** That race is destructive *because* corrections apply as whole records; a
  patch only touches the members it names, so a concurrent edit to a different field now survives. This
  does not close Race 2 — a patch and a concurrent edit to the *same* field still race — but it shrinks
  the blast radius from "every field" to "the named fields." Recorded as a dated note on ADR-008.
- A citable standard replaces prose. `RFC 7396` is a two-page spec; our previous contract was an
  inference.

### Negative

- **Every shipped skill teaching full-record semantics must be rewritten.** `skills/ei-persona/references/cli.md`
  documents the full-record round trip and `pending_update` being wiped; `skills/ei-reflect/references/cli.md`
  teaches read-modify-write. Both become wrong on the day this lands. So do `ei --help` and
  `src/cli/README.md`, which currently say *"full record, not a patch."*
- Because the skills change, users must actually **receive** the re-wired skills — which makes the
  upgrade-prompt bookkeeping fix (`upgrade-prompt-dismiss-is-permanent`) load-bearing for this change,
  not merely adjacent. A user who dismissed the prompt once has a version marker claiming a re-wire
  happened and skills that teach a contract the CLI no longer honours.
- Two call sites must stay in agreement forever (overlay and drain). Consolidating them into one shared
  function is the mitigation, but a future refactor that inlines either one reintroduces the divergence.

### Risks

- **RFC 7396 cannot express "set this member to null."** In the spec, `null` *is* the removal signal.
  Any field where `null` is a meaningful stored value distinct from absent therefore becomes
  inexpressible through this surface. `Quote.message_id` is exactly such a field (`string | null`, where
  null means "unverifiable source") — quotes are out of scope here, which is fortunate rather than
  planned. **Before implementation, persona/person/topic must be swept for any field with the same
  shape.** If one exists, it needs an explicit carve-out and this risk becomes a defect.
- **Silent semantic flip for a wrong-but-working caller.** A caller that currently omits a field
  *intending* the reset gets different behaviour with no error. We believe `pending_update` was the only
  such case; that belief is not proven for third-party callers, of which there are currently none known.
- **The drain must not partially apply.** A patch that fails validation mid-application must leave the
  record untouched rather than half-merged. Full replacement had this property trivially; merging does not.

## Reversibility

Moderate. The schemas and the merge function are additive and removable, and reverting restores
replacement semantics without data migration — nothing is stored differently. What does not revert
cleanly is the documentation and skills surface: users would be running skills that teach patch
semantics against a CLI that replaced records again, which is worse than either consistent state. A
revert therefore has to re-wire skills too, and the upgrade-prompt caveat above applies in reverse.

## References

- `docs/adr/ADR-007-external-reflection-only.md` — recorded this hazard and could only issue an instruction against it
- `docs/adr/ADR-008-accepted-write-races.md` — Race 2, whose blast radius this narrows; see its dated notes
- `docs/adr/ADR-014-quote-attestation-trusts-verified-text.md` — the narrow-what-a-caller-may-assert discipline that `pending_update` clearable-not-settable follows
- [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) — JSON Merge Patch
- `src/cli/persona-corrections.ts:178` — `PERSONA_ROUND_TRIP_FIELDS`, the preserve-on-omit precedent this generalises; `:307` and `:389` are the two `materializeTraits` call sites that make create and update structurally different
- `src/cli/corrections-endpoints.ts:104-154` — fact/topic/person schemas; `:308-389` — `buildAndWriteUpsert`, the shared create/update body this decision splits
- `src/core/processor.ts:822` — `Processor.applyCorrectionRecord`, the live-drain apply path
- `src/core/corrections.ts:724` — `applyCorrectionsToState`, wrapping `applyCorrectionToState`; reached by the CLI overlay at `src/cli/retrieval.ts:70` and by the self-drain at `src/cli/corrections-writer.ts:157`
- `src/core/corrections.ts:238-241` — the codebase naming its own three apply consumers; `:475-478` — the existing hand-maintained duplicate enforcement this decision must consolidate rather than extend
- `src/core/persona-tools.ts` — `preserveHiddenToolGrants()`, the per-field rescue this supersedes
- [GitHub #82](https://github.com/Flare576/ei/issues/82) — where the hazard was first filed as a comment
