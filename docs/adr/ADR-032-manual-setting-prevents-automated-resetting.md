# ADR-032: Manual Setting Prevents Automated Re-Setting — Enforced Structurally, Not by a Marker

## Status

Accepted

## Date

2026-08-04

## Context

Ei has two kinds of writer. **Automated pipelines** — extraction, the daily ceremony, ReWrite, dedup, the
reflection critic — and **manual writers**, meaning anything a human initiated: the TUI, the web app, and
`ei`/MCP calls made by an agent acting on the user's behalf.

The system has behaved as though manual writes take precedence over automated ones, in several places, without
ever stating it. That worked until a case appeared where it silently did not hold.

### The case that surfaced it

`rewrite_length_floor` (`src/core/types/data-items.ts:21`) exists so the ceremony does not repeatedly consider the
same record for rewriting. Once ReWrite has looked at a record, it stamps a floor —
`Math.max(750, ceil(description.length * 1.1))` (`src/core/handlers/rewrite.ts:23`) — and the ceremony skips any
record whose description is still below its floor (`src/core/orchestrators/ceremony.ts:505`, `:516-518`, `:563`).

But the external correction path accepts the field as `z.number().optional()` with no default
(`src/cli/corrections-endpoints.ts:88`) and `buildAndWriteUpsert` spreads the parsed input without recomputing
(`:314-333`). So `undefined` lands in the stored record, and the ceremony's `floor === undefined` branch flags it.

**Net effect: edit a long record through the CLI, MCP, TUI, or web, and the next ceremony immediately queues it
for rewrite — right after the user finished editing it.** Four surfaces, all affected.

### What was already true

Two of the three places this principle applies already honour it, and neither uses an authorship marker:

| Case | Mechanism | Verified |
|---|---|---|
| Facts once set are not re-extracted | Extraction skips facts that already have a description — *"only fill empty ones"* | `src/core/handlers/human-extraction.ts:140-143` |
| Persona identity is never written automatically | `handlePersonaTopicRating` writes only `exposure_current` and `last_updated`. Trait extraction was removed entirely (ADR-023) — `queueAllScans` has exactly four calls. `handlePersonaTraitExtraction` exists but applies only the reflection critic's `pending_update`, which requires the user to accept it | `src/core/handlers/persona-topics.ts:11-68`; `src/core/handlers/persona-generation.ts:113-163` |

Both work by checking **state** ("does a description already exist?") or by simply **not having an automated
writer**. Neither asks "who wrote this last?"

### Why a stored authorship marker was the obvious answer, and is wrong

The tempting design is to record who authored a value and gate automation on it. It does not work here:

- **The distinction is not currently representable.** `last_changed_by` takes persona ids, and extraction stamps
  the extraction persona on every write (`src/core/handlers/human-matching.ts:155`,
  `human-extraction.ts:167-169`). A manual CLI write produces the same shape of value.
- **It is spoofable.** `last_changed_by` is accepted as unvalidated passthrough on external input
  (`src/cli/corrections-endpoints.ts:82-87`), so a caller can claim any authorship. ADR-031 closes that by making
  provenance System Visible — but non-writability alone does not make the two *distinguishable*.
- **It infers what is already known.** Every writer is a code path decided at compile time. There is no write that
  reaches state outside `StateManager`/corrections. Storing a marker to recover a fact the call site already knows
  is strictly worse than reading it at the call site.
- **It needs a migration.** Every existing DataItem would need a value, and no correct value exists for records
  written before the distinction was recorded.

## Decision

**The principle:** *any manual setting of data prevents automated re-setting of that data.*

**The enforcement is structural, not marked.** Each write path has a defined behaviour toward automation-owned
fields. No authorship flag is stored, and none is needed.

**For `rewrite_length_floor`, the field that surfaced this**, the behaviour is expressed through the upsert choke
point using the same absent-versus-`null` vocabulary ADR-029 established for merge patch:

| Caller passes | Meaning | Who does this |
|---|---|---|
| **absent** (`undefined`) | Compute it: `Math.max(750, ceil(description.length * 1.1))` | Every manual writer — CLI, MCP, TUI, web. They get correct behaviour without knowing this field exists |
| **`null`** | Clear it — the description grew past its floor and should be re-evaluated | Extraction, when `newDescLen >= existingFloor` |
| **a number** | Use this value | ReWrite, which computes its own after acting |

**Computed at the choke point, so a new writer cannot forget.** `topic_upsert` and `person_upsert`
(`src/core/state/human.ts:65`, `:90`) already own server-computed fields — `topic_upsert` unconditionally stamps
`last_updated`, `person_upsert` normalizes `identifiers` and derives the primary. Adding the floor computation
there follows the existing pattern rather than introducing one.

That location also catches extraction, which calls the inner upsert directly
(`src/core/handlers/human-matching.ts:162`) rather than the `human-data-manager` wrapper. Extraction is therefore
inside the net and must opt out explicitly with `null` — which is the intent.

**Automation opts out; manual writers get the default.** The inverse — every manual writer remembering to supply a
value — is the forgettable arrangement that produced this bug. A writer added six months from now must not be able
to reintroduce it by omission.

### The stated exceptions, which describe existing behaviour

Topics and People still receive **updates** from the extraction pipeline, and from ReWrite acting on *related*
DataItems. Specifically:

- **Extraction clears the floor** when its update pushes the description past the safety floor. Verified at
  `src/core/handlers/human-matching.ts:160`:
  `existingFloor !== undefined && newDescLen < existingFloor ? existingFloor : undefined` — preserve when the
  description is still under the floor, clear when it has grown past. This is correct and unchanged.
- **ReWrite does not clear the floor**; it recomputes it from the new content
  (`src/core/handlers/rewrite.ts:189`, `:204`, `:283-290`).

Both were already true before this ADR. Only the manual-write path was missing its half.

### The behavioural change this makes, stated plainly

**A human edit ceases to be a rewrite trigger.** Paste ten thousand characters into a description through any
manual surface and the record will not be queued for rewrite — the write sets a floor above its own length.
Previously it would have been queued, by accident.

This is deliberate. A deliberate human edit should not be second-guessed by a length heuristic; a user who wants a
rewrite can ask for one. But it is a real change in behaviour and not a pure bug fix.

## Alternatives Considered

### Alternative A: A reserved authorship id
- **Description**: reserve a `last_changed_by` value meaning "external/manual", following the `RESERVED_PERSONA_IDS`
  pattern already used for `ei` and `emmet`. Automation checks it before overwriting.
- **Pros**: makes the general rule enforceable for any future field, not just this one. Reuses an existing convention.
- **Cons**: needs ADR-031's non-writability *plus* a distinguishable value *plus* a migration for existing records.
  And it recovers at read time a fact the write site already knew.
- **Why not chosen**: it stores an inference instead of reading the truth. Every writer is a known code path; there
  is nothing to infer.

### Alternative B: A dedicated `authored_by: "system" | "external"` field
- **Description**: a new field on `DataItemBase`, set unambiguously by each writer.
- **Pros**: semantically clean and unspoofable once ADR-031 makes it non-writable.
- **Cons**: a new field on every DataItem, a migration with no correct value for existing records, and it still
  only re-encodes what the call site knows.
- **Why not chosen**: same objection as A, at higher cost.

### Alternative C: Every manual writer supplies the floor explicitly
- **Description**: the originally proposed shape — extraction clears, everybody else passes `1.1 × length`.
- **Pros**: no change to the upsert; entirely explicit at each call site.
- **Cons**: forgettable. A new write path that omits the parameter silently reintroduces this exact bug, and the
  failure is invisible until a user notices their edited record being rewritten.
- **Why not chosen**: same shape of defect this ADR exists to close. Making automation opt out inverts the failure
  mode — a forgetful *automated* writer preserves a floor it should have cleared, which is conservative rather than
  destructive.

### Alternative D: Preserve the existing floor on manual write
- **Description**: keep whatever floor was stored rather than recomputing.
- **Pros**: simplest possible change.
- **Cons**: a record edited from 800 to 8,000 characters keeps its 880 floor and is never re-evaluated, permanently.
- **Why not chosen**: trades an over-eager rewrite for a rewrite that can never happen.

## Consequences

### Positive

- A four-surface user-facing defect closes.
- A new write path inherits correct behaviour without knowing the field exists.
- The absent/`null`/value vocabulary matches ADR-029, so the codebase has one convention for
  "compute it / remove it / use mine" rather than two.
- The formula stops being duplicated: it currently appears at `rewrite.ts:47`, `:53`, `:191`, `:240`, `:283`,
  `:289` and must be extracted to be shared.

### Negative

- **Human edits no longer trigger rewrites at all.** Accepted, and stated above rather than discovered later.
- The upsert choke point gains behaviour, so `topic_upsert`/`person_upsert` are no longer purely mechanical. They
  already were not — `last_updated` — but this deepens it.
- The principle is now written down and will be measured against. See the known gap below.

### Risks

- **The principle is broader than its enforcement.** This ADR records a general rule but implements it for one
  field. Every other case is honoured by accident of how the code happens to be written, not by a mechanism. A
  future automated writer could violate it without tripping anything.

- **`dedup` is Manual, not automated — verified, after an initial wrong reading.** `src/core/handlers/dedup.ts:74-248`
  overwrites `description`, `name`, `sentiment`, `relationship`, `category`, and `identifiers` on the merge survivor
  with no authorship gate, which looks like a violation. **It is not**, because dedup is **user-initiated**: it was
  deliberately removed from the ceremony, since *detecting* a duplicate reliably proved impractical. A user asking
  "merge these two records" is a manual write, and manual-overwriting-manual is permitted by this principle.

  **The trigger determines the category, not the mechanism.** A merge whose content an LLM decides is still Manual,
  because the user asked for that specific write. Compare extraction, which runs as a side effect of a message the
  user sent without asking for extraction — that is Automated. The test: **did the user ask for this specific write
  to happen?**

  This was initially recorded here as a live violation, on the strength of three strings in
  `src/core/orchestrators/ceremony.ts` that describe dedup as ceremony Phase 1 — a log at `:89` claiming *"Dedup
  phase queued"*, a doc comment at `:170` listing *"Phase 1: Dedup"*, and a log at `:179` saying *"Dedup complete"*.
  **All three are stale.** `startCeremony` (`:60-90`) queues no dedup work; its own doc comment (`:53-58`) lists the
  real phases as Exposure → Decay → Person Rewrite → Topic Rewrite, and `:82-84` shows phase 1 is *migration*.
  Tracked for cleanup in `.sisyphus/issues/pre-release-adr-batch-stale-code-cleanup.md`.

  **What remains genuinely open is a quality question, not a rule question:** an LLM-decided merge could produce a
  worse description than the human wrote. That is reviewable by the user who asked for it, and is out of scope here.

- **Extraction merges identifiers ungated.** `src/core/handlers/human-matching.ts:323` unions
  `candidateIdentifiers` into a matched person on every extraction pass, with no check on whether a human authored
  the existing set. This is also the ingress path ADR-010's link guard polices, so the two concerns meet at one line.

## Reversibility

High. The floor computation is additive and localized to the upsert choke point plus the extraction opt-out.
Reverting restores the previous behaviour, including the defect. Nothing is stored differently, so no migration is
needed in either direction.

## References

- `docs/adr/ADR-031-external-field-visibility-categories.md` — makes provenance System Visible; a prerequisite for
  any marker-based approach, which is precisely why the marker approaches were still rejected
- `docs/adr/ADR-029-merge-patch-write-semantics.md` — the absent/`null`/value vocabulary reused here
- `docs/adr/ADR-023-human-trait-extraction-dropped.md` — why nothing automatic writes persona traits
- `docs/adr/ADR-018-ceremony-rates-exposure-never-identity.md` — the ceremony's identity boundary, verified holding
  at `src/core/handlers/persona-topics.ts:11-68`. Its `exposure_desired` claim **holds** — it governs `PersonaTopic`,
  written only at creation. *(An earlier revision of this line said the claim was "contradicted by
  `human-matching.ts:150`." That was a category error: `:150` writes a human `Topic`, a different type. Corrected
  2026-08-04; see ADR-018's scope note for the three-type table.)*
- `src/core/handlers/rewrite.ts:23` — `MIN_REWRITE_FLOOR` and the formula to extract
- `src/core/orchestrators/ceremony.ts:505,516-518,563` — the gate this protects
- `src/core/handlers/human-matching.ts:160` — extraction's clear-when-grown rule, unchanged by this decision
- `src/core/state/human.ts:65,90` — the upsert choke points, which already own server-computed fields
- `src/cli/corrections-endpoints.ts:88,314-333` — where the floor is currently dropped
