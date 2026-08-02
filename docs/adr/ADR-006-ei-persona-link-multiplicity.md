# ADR-006: Persona-to-Person Link Multiplicity

## Status

**Proposed.** One question in the Decision section is genuinely open and belongs to the project owner. Everything else here is settled and safe to build against.

## Date

2026-08-01

## Context

Ei links a Persona to a Person record through an identifier on the Person: `{ type: "Ei Persona", value: <persona uuid> }`. That linked Person record is the **PersonLog** — the accumulating behavioral record that reflection reads and clears.

Three places in the codebase describe the cardinality of that link, and they do not agree.

**`src/cli/retrieval.ts`, on `lookupByIdentifier`** — returns the first matching Person, and its comment states this is *"safe for identifier types that are unique by construction (e.g. `Ei Persona`, a UUID assigned once per persona), but arbitrary if more than one Person shares a value under a type that isn't guaranteed unique."* This asserts one persona uuid appears on at most one Person.

**`src/core/orchestrators/ceremony.ts`, in the reflection phase** — filters every Person carrying this persona's id, and if more than one is found, refuses to reflect and writes a user-facing warning. So this code path is built for exactly the situation the comment above says cannot happen.

**`CONTRACTS.md`** — states a single Person record may carry multiple `ei_persona` identifiers.

The three are not actually describing the same thing, which is most of why they read as contradictory. There are **two distinct multiplicities**:

| Shape | Meaning | Status |
|---|---|---|
| One Person, many persona ids | A single human record associated with several personas | Explicitly permitted by `CONTRACTS.md` |
| Many Persons, one persona id | Several human records each claiming the same persona | The case ceremony detects and refuses |

`CONTRACTS.md` permits the first. `retrieval.ts` asserts the second does not happen. Ceremony handles the second anyway. Only the second is contested.

## Decision

**Settled: any consumer resolving a Persona's log must enumerate all linked Person records and never silently take the first.**

This holds regardless of how the open question below resolves, because the situation demonstrably *can* occur — ceremony's branch exists, fires, and writes a warning a user can read. Whether it is legal or a defect, code that assumes it away will pick an arbitrary record and clear the wrong log. The reflection skill therefore enumerates and asks; the readiness notice aggregates across all linked records rather than reading one.

**Open — belongs to the project owner:** is *many Persons sharing one persona id* a supported configuration or a data defect?

The evidence points both ways, which is why this is not being decided here:

- Ceremony's warning text tells the user *"This might be intentional — if you created a composite persona."* That reads as sanctioning it.
- But "composite persona" more naturally describes the **other** multiplicity — one Person holding several persona ids — which is the shape `CONTRACTS.md` actually permits. So the warning may be describing a configuration it did not detect.

Resolving it decides two follow-on corrections:

- **If it is a defect:** `retrieval.ts`'s comment is correct, ceremony's warning text should stop suggesting intent, and the warning should point toward repair.
- **If it is supported:** `retrieval.ts`'s comment is wrong and its first-match behavior is arbitrary for `Ei Persona` too, `CONTRACTS.md` should document the shape, and ceremony's refusal to reflect needs a defined resolution path rather than a permanent pause.

## Alternatives Considered

### Alternative A: Decide it here, in favour of uniqueness
- **Description**: Declare many-Persons-one-persona a defect, correct ceremony's warning text, ship.
- **Pros**: Closes the contradiction now. Matches the most likely original intent, since a persona uuid is generated once.
- **Cons**: Would silently reclassify any existing install that has this shape — plausibly created deliberately — as corrupt, and the warning text is the only user-facing communication about it.
- **Why not chosen**: The reclassification is a product decision with a user-visible consequence, and nothing in source establishes intent strongly enough to make it unilaterally.

### Alternative B: Decide it here, in favour of multiplicity
- **Description**: Declare it supported, correct `retrieval.ts`, define a resolution path for reflection.
- **Pros**: Matches the warning's own wording and requires no user's data to be called broken.
- **Cons**: Rests entirely on one parenthetical in a log message, against a comment that reasons explicitly about uniqueness. Also leaves reflection permanently paused for those personas with no defined way forward.
- **Why not chosen**: Same reason — insufficient evidence, and this direction carries the larger implementation burden if wrong.

### Alternative C: Leave the contradiction unrecorded
- **Description**: Ship the enumerate-and-ask rule and say nothing about the disagreement.
- **Pros**: No open ADR.
- **Cons**: The next reader re-derives the whole thing, and the two source sites keep asserting incompatible invariants at each other indefinitely.
- **Why not chosen**: Recording a live disagreement is more useful than a decision that was never actually made. An ADR marked Proposed is honest; one marked Accepted here would not be.

## Consequences

### Positive
- The enumerate-and-ask rule is safe under either resolution, so dependent work proceeds without waiting.
- The disagreement is now written down in one place instead of being rediscovered from three.

### Negative
- The index carries a Proposed entry, and two source sites keep contradicting each other until it resolves.

### Risks

- **The uniqueness comment is load-bearing and easy to trust.** `lookupByIdentifier`'s first-match behavior is documented as safe specifically for `Ei Persona`. Anyone reading only that comment will write first-match code. Until this resolves, treat the comment as an assumption rather than a guarantee.

- **The warning text may be actively misleading.** If many-Persons-one-persona is a defect, the message currently tells users it might be intentional — which would discourage the very repair it should prompt.

## Reversibility

Trivial. Nothing is built on this record yet; the settled half only forbids an assumption. Resolving the open question amends this ADR and corrects at most one comment, one warning string, and one CONTRACTS row.

## References

- ADR-001 — the Persona / Agent split that makes the PersonLog worth resolving correctly
- ADR-007 — the opt-out flag whose readiness notice aggregates across linked records under the settled rule
- `src/cli/retrieval.ts` — `lookupByIdentifier` and the uniqueness comment
- `src/core/orchestrators/ceremony.ts` — the reflection phase's multi-record detection and its warning text
