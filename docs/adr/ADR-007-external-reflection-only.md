# ADR-007: A Persona May Opt Out of the Automatic Reflection Critic

## Status

Accepted

## Date

2026-08-01

## Context

Ei's ceremony runs an automatic Reflection critic over any Persona whose linked Person record — the **PersonLog** — has grown past a threshold. The critic proposes an identity revision and then **clears the log**, since its content has been consumed.

ADR-001 established that a coding-harness PersonLog accumulates two categorically different kinds of evidence, and that the critic can only act on one of them. For personas that do technical work all day, the dominant signal is operating contract, which the critic cannot process — so it discards it.

That leaves a sequencing problem rather than a capability problem. An external, agent-aware reflection *can* process both kinds of evidence, but it can only do so while the evidence still exists. The automatic critic and the external reflection both want to consume the same log, and whichever runs first destroys the other's input.

The automatic critic is not wrong for most personas. Ei's own persona has no harness contract to reflect on; the critic is exactly right there. So the decision is per-Persona, not global.

## Decision

Add an optional boolean `external_reflection_only` to `PersonaEntity`. When set, Ei's automatic critic skips that Persona entirely, leaving the log intact until an external reflection processes and clears it.

**The gate applies at two points, not one:**

| Point | Location | Why |
|---|---|---|
| Queue time | `queueReflectionPhase` | Prevents the request being created at all |
| Handler time | `handleReflectionCritic` | Catches a request queued *before* the flag was set |

**At handler time the gate must suppress both of the function's writes.** It clears the log via `human_person_upsert` with an emptied description, and separately writes `pending_update` on the Persona via `persona_update` after an early return on a null result. These are independent. A guard placed around only the clear leaves the second write live — so the log survives, and Ei still queues an unrequested identity revision for a Persona that opted out of precisely that.

That asymmetry is the whole reason the gate is specified as two points covering two writes rather than "skip the critic."

## Alternatives Considered

### Alternative A: Use the existing `is_paused` flag
- **Description**: Mark the Persona paused; the ceremony already skips paused Personas.
- **Pros**: Zero new fields. Already plumbed through every surface.
- **Cons**: `is_paused` stops *all* automatic activity for that Persona, including heartbeats and extraction. The requirement is narrow — keep everything, skip one phase.
- **Why not chosen**: It solves the problem by disabling the feature set the user wants to keep.

### Alternative B: A global "external reflection" mode
- **Description**: One setting disabling the automatic critic for every Persona.
- **Pros**: Simplest possible implementation.
- **Cons**: The correct answer differs per Persona in the same install. A coding-harness persona wants external reflection; Ei's own persona wants the automatic critic.
- **Why not chosen**: Forces one answer onto a question that is genuinely per-Persona.

### Alternative C: Remove the automatic critic
- **Description**: Make all reflection external.
- **Pros**: One code path. No flag, no gate, no race.
- **Cons**: The automatic critic works well for the personas it was built for, and requires nothing of the user. External reflection requires a user present and willing.
- **Why not chosen**: Trades a working default for a manual step, for every user, to serve a minority of personas.

### Alternative D: Queue-time gate only
- **Description**: Filter in `queueReflectionPhase` and stop there.
- **Pros**: One edit, one obvious site.
- **Cons**: A critic enqueued before the flag was set still runs to completion, clearing the log — the exact loss the flag exists to prevent. The window is small but it is precisely the window a user hits when they set the flag *because* they just noticed the log is large.
- **Why not chosen**: The failure mode is the motivating case, not an edge case.

## Consequences

### Positive
- The evidence survives long enough for a lens that can actually process it.
- The choice is per-Persona, so the automatic critic keeps working where it already works.
- The field is optional and defaults to `false`, so no existing install changes behavior.

### Negative
- An opted-in Persona's log grows without bound until an external reflection runs. Nothing reclaims it automatically, by design — but a user who sets the flag and then never reflects has a log that only grows.
- Two gate points is more surface than one, and both must stay correct. A future refactor that consolidates them risks reintroducing the handler-time hole.

### Risks

- **The half-implemented guard is the likely regression.** The queue-time gate is obvious and will be preserved by anyone reading the code. The handler-time gate — and specifically its coverage of the `pending_update` write — is easy to lose. Mitigation: a regression test asserting **both** writes are absent for an opted-out Persona. Note an existing escape-hatch test asserts absence of `persona_update` while asserting the clear *did* happen; it would stay green against a half-implemented guard and is therefore not a substitute.

- **Unbounded log growth has no safety valve.** The threshold that previously triggered the critic now triggers nothing for opted-in Personas. Mitigated only by surfacing the log's size to the user (see the readiness notice added to the persona relationship block), which prompts rather than enforces.

- **A silent per-surface reset.** The field is a schema-defaulted boolean, so any full-record write path that omits it resets it to `false` — silently, with a success exit. This is a general hazard of the persona corrections schema, not specific to this field: the same shape already required a dedicated preservation helper for tool grants. Any new editing surface must round-trip the field explicitly.

## Reversibility

Easy. The field is optional with a `false` default and no migration; removing it restores the previous behavior for every Persona. The two gates are additive filters, not restructurings. What would be lost is any log preserved *because* of the flag, if it had not yet been reflected on.

## References

- ADR-001 — why the evidence is worth preserving in the first place, and the two-lens split it feeds
- ADR-003 — the PersonLog clear timing this flag defers
- ADR-008 — Race 1, the drain/dispatch timing race this flag's protected-run promise makes user-visible
- `src/core/orchestrators/ceremony.ts` — the reflection phase, its threshold constant, and the multi-record warning path this gate must not disturb
- `src/core/handlers/heartbeat.ts` — `handleReflectionCritic` and its two write sites
- `src/cli/persona-corrections.ts` — the schema and the two record literals a new persona field must appear in
