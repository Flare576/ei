# ADR-006: A Person Record and a Persona Link One-to-One

## Status

Accepted

## Date

2026-08-01

## Context

Ei links a `Person` record to a `PersonaEntity` through an identifier on the Person: `{ type: "Ei Persona", value: <persona id> }`. That linked Person record is the **PersonLog** — the accumulating behavioral record reflection reads and clears.

The original design deliberately allowed a **many-to-many** graph. The intent was composites: someone curious what a persona blending King and Einstein would be like could point both the King and Einstein Person records at that one Persona. If they also kept standalone King and Einstein Personas, each Person record would then carry several `Ei Persona` identifiers, overlapping at the composite.

Three sites described the resulting cardinality inconsistently — `CONTRACTS.md` permitted many, `lookupByIdentifier`'s comment asserted uniqueness "by construction," and the ceremony's reflection phase detected and refused the many case while calling it *"might be intentional — if you created a composite persona."* That disagreement is what opened this record.

The disagreement turned out to be downstream of the design, not a misunderstanding of it. The design was real; it is now rejected.

## Decision

**A `Person` record carries at most one Persona link, and a Persona is linked from at most one `Person` record.**

**"At most," not "exactly."** Most Person records have no Persona link at all, and that is correct — an ordinary human you know is not a Persona. `identifiers: []` is valid and accepted, and `src/core/handlers/rewrite.ts:257-270` deliberately creates Person records with empty identifiers. The constraint forbids a *second* link in either direction; it does not require a first.

This distinction is load-bearing for whoever enforces it. Read as "exactly one," a faithful implementer would reject valid unlinked people or try to auto-link every Person to something — both worse than the shape being fixed.

A composite is still supported — it simply gets its own Person record rather than being expressed as a shared link:

```
Person:Einstein        <->  Persona:Einstein
Person:King            <->  Persona:King
Person:King_Einstein   <->  Persona:King_Einstein
```

The composite Persona gets a composite Person, and the graph stays a set of pairs. Nothing a user could express under the old model becomes unexpressible; it just stops being expressed by overlapping edges.

**This is a decision about intent, not a description of current code.** The codebase permits and actively creates the many-to-many shape today. The gap between this record and reality is a tracked fix, not an oversight — see the footprint below.

## Alternatives Considered

### Alternative A: keep many-to-many
- **Description**: Leave the graph as designed; correct the docs and the first-match sites to handle multiplicity properly.
- **Pros**: No migration. Composites keep the more compact expression.
- **Cons**: Every consumer resolving "the log for this Persona" must handle zero, one, or many, and choose between them — which is a question with no good automatic answer. The ceremony already refuses rather than choosing, and the reflection skill has to stop and ask a human. The expressive gain is one saved record; the cost is an unanswerable question at every read site.
- **Why not chosen**: The project owner's assessment on revisiting it: *"In retrospect... that is stupid, and we should not do that."*

### Alternative B: one Person, many Personas — but not the reverse
- **Description**: Permit a Person to carry several `Ei Persona` identifiers; forbid several Person records sharing one persona id.
- **Pros**: Resolves the only genuinely ambiguous direction — "which log belongs to this Persona" gets one answer. Keeps the composite expression.
- **Cons**: Leaves the inverse question ("which Persona is this human?") ambiguous, which matters for attribution. And it is a subtler rule to hold in mind than a pair.
- **Why not chosen**: Half a constraint is harder to reason about than a whole one, and the composite use case is already served by its own record.

### Alternative C: defer, keep ADR-006 Proposed
- **Description**: Leave it open until something forces the issue.
- **Pros**: No fix work.
- **Cons**: The contradiction is live, load-bearing, and already producing wrong behavior — `handleReflectionCritic` clears whichever record `lookupByIdentifier` happens to return first.
- **Why not chosen**: An unresolved cardinality question is what let three sites drift apart in the first place.

## Consequences

### Positive
- "Which log belongs to this Persona" has at most one answer, so consumers stop needing an enumerate-and-ask branch. Zero stays valid and already has defined handling — the ceremony skips a Persona with no linked record.
- The first-match sites that are wrong today become correct once the constraint holds, rather than needing individual repair.

### Negative
- The codebase does not satisfy this yet. Until it does, this record describes intent and the enumerate-all rule below remains mandatory.
- Existing installs may hold data in the old shape. Any enforcement needs a repair path, not just a guard.

### The footprint, as investigated

Moderate — real, bounded, spread across core, CLI, web, TUI, skills, and tests. Not schema-wide.

**Paths that create the many shape today.** Not only hand-editing, which is the finding that matters most:
- Web link action (`web/src/App.tsx:917-927`) and the PersonCard add-row (`:145-173`, `:289-417`) both append without a uniqueness check; the link guard checks only the selected person, so one Persona can be linked from several.
- TUI `/p update` appends (`tui/src/commands/persona.tsx:417-423`); `/me` YAML round-trips every identifier.
- CLI and MCP accept full identifier arrays.
- **The LLM's `handlePersonUpdate` accepts and commits `Ei Persona` arrays** (`src/core/handlers/human-matching.ts:277-313`, `:328-345`).
- **Dedup merges identifiers by value and can combine distinct persona ids** (`src/core/handlers/dedup.ts:50-96`, `:177-184`), and its prompt instructs a union.

The last two contradict `CONTRACTS.md`'s claim that these links are *"always user-initiated — the system never auto-links without confirmation."* That claim is already false.

**Sites that already assume one.** These are wrong under today's permissive model and become correct under this decision:
- `human_person_getByIdentifier` (`src/core/state-manager.ts:738-743`) and `lookupByIdentifier` (`src/cli/retrieval.ts:660-690`) both return the first match.
- **`handleReflectionCritic` delegates to first-match and then clears only that record** (`src/core/handlers/heartbeat.ts:137-145`) — under the many shape it clears an arbitrary log.
- `ensureEiPersonaHasNickname` uses the first `Ei Persona` identifier only.
- TUI `/p update` without a persona name resolves to the first linked record.

**Sites that correctly handle many**, and can be simplified once the constraint holds: the ceremony's reflection phase (enumerate, warn and pause on more than one), the readiness resolver (`resolvePersonLogLength`, max across linked records), and the `ei-reflect` skill (all-match, ask the user).

**Enforcement has no single chokepoint.** `applyCorrectionToHuman` bypasses `StateManager`, so a constraint placed there alone would not cover the corrections path. Dedup's update-before-remove sequence also creates a transient duplicate mid-merge, which a naive check would reject.

**No existing link-repair machinery.** Dedup merges Person records and re-points quote foreign keys, so the shape to copy exists — but no routine specifically repairs persona links.

### Until the constraint is enforced

**Enumerate all linked records; never take the first.** This holds regardless, because the situation occurs in data whether or not it is legal. Code assuming one will silently pick an arbitrary record — which, for the critic, means clearing the wrong log.

### Risks

- **Repair before enforcement, or the guard rejects real data.** An install already holding the many shape will fail a naive uniqueness check on the next write to an unrelated field. Sequence matters.

- **`handleReflectionCritic` is the sharp edge today.** It is the one first-match site whose consequence is destructive rather than merely wrong. Worth fixing ahead of the general constraint if enforcement is not immediate.

- **The exact-case sites are a separate, overlapping hazard.** Several sites match `'Ei Persona'` exactly while the documented contract is case-insensitive. Enforcement written against one convention will miss records written under the other.

## Reversibility

Moderate. The decision itself is cheap to revisit — nothing built yet depends on it, and the enumerate-all rule is safe either way. Reversing it *after* enforcement and a data migration would be expensive, since the migration splits records and the split is not automatically undoable.

## References

- ADR-001 — the Persona / Agent split that makes the PersonLog worth resolving to one record
- ADR-007 — the opt-out whose readiness notice aggregates across linked records under the interim rule
- `src/core/orchestrators/ceremony.ts` — the reflection phase's multi-record detection and warning
- `src/core/handlers/heartbeat.ts` — the first-match clear, the destructive case
- `src/cli/retrieval.ts` — `lookupByIdentifier` and `resolvePersonLogLength`
- `src/core/handlers/dedup.ts` — identifier union, and the transient-duplicate window
