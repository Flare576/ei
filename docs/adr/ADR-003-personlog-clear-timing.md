# ADR-003: PersonLog Clears at Critic Completion, Not at User Decision

## Status

Accepted

## Date

2026-08-01

## Context

`handleReflectionCritic` (`src/core/handlers/heartbeat.ts:130-140`) sets the linked Person record's `description` to `""` as soon as a valid critic result arrives — **before** the user accepts or dismisses the resulting `pending_update`.

This reads as a bug on first inspection, and was reported as one during planning. If the user dismisses the proposal, the evidence that produced it is already gone and unrecoverable. A `console.log` of the log contents sits directly above the clear, marked `TODO: Remove before v1 — debug logging`, which reinforces the impression that something is unfinished here.

It is not a bug. Recording that explicitly is the entire purpose of this ADR.
### PersonLog growth is deliberate, and defended in three places

Understanding this decision requires knowing that unbounded growth is not an accident the clear is compensating for. It is an intended property, enforced independently at three points:

| # | Mechanism | Location | Rationale |
|---|---|---|---|
| 1 | Ei-linked Person records are told *"add, never truncate"*; regular person records are told *"synthesize, don't accumulate"* | `src/prompts/human/person-update.ts:124-142` vs `:145-167` | **STATED** — Ei logs are "observed experience / field notes"; preserving concrete behavior is the point, and "brevity is wrong here" |
| 2 | The generic Person Rewrite phase, which slims oversized records, **excludes** any person carrying an `ei persona` identifier before it even applies its size threshold | `src/core/orchestrators/ceremony.ts:495-501` | **INFERRED** — the filter is `!isPersonaLinked` with no explanatory comment. Preserving the cumulative log is the obvious reading, but nobody wrote it down |
| 3 | The reflection critic clears the log only on completion | `src/core/handlers/heartbeat.ts:130-140` | **STATED** — this ADR |

Two consequences follow:

- **A large PersonLog is not evidence of a defect.** Three separate mechanisms cooperate to produce it. Any future investigation into "why is this log so big" should start here rather than treating size as a symptom.
- **Mechanism 2 is undocumented and therefore fragile.** A future maintainer tidying the Rewrite filter has nothing in the code telling them that carve-out is load-bearing. Adding a comment there is a cheap, high-value fix.

## Decision

Clear the PersonLog at critic completion, not at user decision.

The rationale is token cost. Person records are injected into persona system prompts. A PersonLog is allowed to grow without bound by design — the extraction prompt for Ei-linked personas says *"add, never truncate"* — and the reflection critic fires at 3,000 characters (`PERSON_LOG_REFLECTION_THRESHOLD`, `src/core/orchestrators/ceremony.ts:22`). Every character above that is paid for on every prompt that includes the record. Clearing at critic completion bounds the cost deterministically.

## Alternatives Considered

### Alternative A: Clear only on accept
- **Description**: Retain the log until the user applies the proposed identity update; discard on accept, keep on dismiss.
- **Pros**: Evidence survives a dismissal. Matches the intuition that you should not destroy inputs before the output is approved.
- **Cons**: A dismissed proposal leaves the log in place and still growing, so it re-crosses the threshold immediately and the next ceremony re-runs the critic over substantially the same content. Cost is unbounded exactly in the case where the user has signalled the analysis was not useful.
- **Why not chosen**: Makes the expensive path the default for the least valuable outcome.

### Alternative B: Archive the log before clearing
- **Description**: Copy the log to a separate store, then clear.
- **Pros**: Fully recoverable. Enables future analysis of what evidence produced which identity changes.
- **Cons**: New storage surface, new lifecycle, new growth problem relocated rather than solved. No consumer exists for archived logs today.
- **Why not chosen**: Solving a hypothetical need with a real maintenance burden. Revisit if a consumer appears.

### Alternative C: Cap the injected length instead of clearing
- **Description**: Keep the full log; truncate at injection time.
- **Pros**: Bounds prompt cost without destroying evidence.
- **Cons**: Bounds the *display*, not the *growth*. The stored record still grows without limit, and the critic still receives the whole thing — the reflection payload itself is uncapped.
- **Why not chosen**: Addresses the symptom at one call site while the underlying growth continues. Worth revisiting as a complement, not a replacement.

## Consequences

### Positive
- Prompt cost from Person records is deterministically bounded.
- Each reflection cycle operates on genuinely fresh evidence rather than re-analyzing a growing accumulation.

### Negative
- **Dismissing a proposal destroys the evidence that produced it.** The user cannot review what the critic saw after declining its conclusion.
- For agent-facing personas, the automatic critic consumes Agent-lens evidence it cannot act on. This is the specific failure that `external_reflection_only` exists to prevent (see ADR-001) — that setting suppresses the automatic critic for opted-in personas so an external, agent-aware reflection can run first.

### Risks
- **Insufficient evidence to evaluate the trade-off.** The population of humans who trigger reflections is currently one. There is no real usage signal on whether the dismissal case matters in practice. The decision is correct for a user pool of one and is explicitly provisional beyond that.
- **Revisit trigger**: more than one human running reflections, or the first report of a user wanting to inspect evidence behind a dismissed proposal.

## Reversibility

Easy. The clear is a single write in one handler. Moving it behind the accept/dismiss decision is a small, local change with no data migration. This ADR should be superseded rather than quietly reverted, so the token-cost reasoning is not lost a second time.

## References

- `src/core/handlers/heartbeat.ts:130-140` — the clear
- `src/core/orchestrators/ceremony.ts:22` — the 3,000-character trigger threshold
- `src/prompts/human/person-update.ts:124-142` — the "add, never truncate" instruction that makes growth intentional
- ADR-001 — the reflection separation that `external_reflection_only` serves
