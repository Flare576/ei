# ADR-010: Invalid Persona Links Are Reported, Never Repaired Automatically

## Status

Accepted

## Date

2026-08-01

## Context

ADR-006 settled the *shape*: a `Person` record carries at most one `Ei Persona` link, and a Persona is linked from at most one `Person` record. It deliberately did not say what happens to data that already violates that shape, or what a write that would violate it should do. Both are load-bearing, and neither is an implementation detail — a naive uniqueness check dropped onto an install already holding the invalid shape fails the user's *next unrelated edit*, so they get an error changing a nickname because of a link something made months ago.

Two invalid shapes exist:

- **A-many** — one `Person` record carrying two or more `Ei Persona` identifiers.
- **B-many** — two or more `Person` records carrying the same `Ei Persona` value.

Both are reachable today, and not only by hand. The LLM person-update handler commits identifier arrays (`src/core/handlers/human-matching.ts:277-313`), and dedup unions identifiers when merging Person records (`src/core/handlers/dedup.ts:50-96`). Links are now most often created *implicitly*, as a side effect of creating a Persona or updating a Person record.

Under the pre-ADR-006 design, the many shape was legal and meaningful: a composite persona was expressed as overlapping links. That is rejected — a composite gets its own Person record. **So there is no longer any legitimate instance of the invalid shape to preserve.** Every occurrence is a mistake.

That reframes the question. It is not "how do we correctly merge these" but "who fixes a mistake, and when do they find out."

## Decision

**1. Invalid link cardinality is detected and reported. It is never repaired automatically.**

No migration, no silent correction, no first-match resolution. The system tells the user what it found and stops touching it.

**2. Detection runs at startup, unconditionally, and covers both directions.**

Not gated on any threshold, and not only during the daily ceremony.

**3. Reporting reuses the existing mechanism** — a `role: "system"` message appended to the `ei` persona's thread with `context_status: ContextStatus.Always`, the shape already used at `src/core/orchestrators/ceremony.ts:644-652`.

Ei already exists to tell the user when something about their data looks wrong. This is that, so it uses that.

**4. A write that would create the invalid shape applies its valid parts, drops the offending link, and reports through the same channel.**

The alternative — rejecting the whole upsert — means one bad link in an LLM full-record update discards a legitimate description edit alongside it. Dropping only the link preserves the rest.

**No bespoke alert surface is built for this.** The shape should never occur; a dedicated resolution UI would be machinery for a state nobody reaches.

**5. Deleting a Persona removes its links from Person records.** Pre-existing orphaned links — values pointing at a Persona that no longer exists — are left alone. No migration cleans them.

**6. `Ei Persona` is persisted exactly as the user typed it and matched case-insensitively.**

The type string is user-visible and meant to be user-friendly, so the stored casing is theirs. Every semantic consumer lowercases before comparing. The separator is not flexible: `ei_persona` is not a variant spelling, it matches nothing, and it fails silently with an empty result rather than an error.

## Consequences

### Positive

- No step in this design silently changes a user's data. That is the whole point of it.
- Startup detection means the user learns about the problem near when it was caused, rather than whenever a log happens to cross a size threshold.
- Nothing needs to decide which of two links or two Person records is the "real" one — the case where that judgment would be required is exactly the case handed back to the human.
- The reporting mechanism already exists and is already trusted for this class of message. No new surface to design, build, or teach.

### Negative

- Invalid data persists until a human acts. An install can carry the broken shape indefinitely.
- Consumers must therefore keep tolerating it. The interim rule stands until enforcement *and* user cleanup are both real: **enumerate all linked records, never take the first.**
- The user is asked to fix something they very likely did not knowingly cause, since links are usually created implicitly.

### Risks

These were open questions when the decision was made and have since been checked against source. Two are resolved, three are real and must be handled by the implementation.

- **Resolved — the warning is visible from outside the thread.** `messages_countUnread` counts unread `system` messages (`src/core/state/personas.ts:186-189`), `getPersonaList` carries the count (`src/core/persona-manager.ts:13-22`), the TUI Sidebar renders `(N new)` (`tui/src/components/Sidebar.tsx:76-80`), and the web PersonaPanel badges it (`web/src/components/.../PersonaPanel:137-139,334-336`). The channel works.
- **Open — but the badge can clear itself unread.** The TUI marks a persona read after a 5-second dwell on auto-select (`:268-285`), and the web marks the previous persona read on manual switch (`:584-588`). If Ei is the landing persona, a warning can be marked read without anyone reading it. Any implementation relying on the unread count as the signal has to survive that.
- **Open — the report can no-op silently.** `PersonaState.messages_append` returns without error if the target persona is missing (`src/core/state/personas.ts:126-130`), and an existing nonempty state lacking an Ei persona is not repaired by the first-run bootstrap condition (`src/core/processor.ts:282-316`). On such an install the detection runs, finds the problem, writes nothing, and reports success. That is a check that cannot fail — the exact failure class this ADR exists to avoid — so the write must be verified rather than assumed.
- **Open — nothing dedups.** Exact searches for a prior-warning guard, an `messages_get("ei")` content comparison, or a deterministic message id returned nothing; `messages_append` pushes unconditionally. A persistent condition therefore warns on every launch forever, and the ceremony path can emit a second copy in the same session. Startup detection **must** carry a dedup rule; without one this trains the user to ignore the channel, which is worse than not warning at all.
- **A stronger channel exists if the message proves too weak.** `Processor` already drives a genuine user-facing interrupt at startup for sync conflicts — `onStateConflict` (`src/core/processor.ts:223-233`) renders a TUI overlay (`tui/src/context/ei.tsx:990-992,1162-1167`) and a web modal (`web/src/App.tsx:434-436,1581-1590`). Escalating to it is a live option, not a redesign, if the passive message turns out to be ignorable.

## Notes on the existing implementation

The mechanism being reused has three defects that must be fixed as it moves, rather than carried:

1. **It only detects B-many.** The filter at `ceremony.ts:631-633` collects People linking to a given persona, so `linkedRecords.length > 1` catches several People sharing one Persona. One Person carrying two `Ei Persona` identifiers is not detected anywhere in `src/`.
2. **It is gated behind the reflection threshold.** `:637-638` filters to linked records whose log exceeds `PERSON_LOG_REFLECTION_THRESHOLD` and `continue`s if none qualify — *before* the multiplicity check. A broken link shape on a small log is never reported.
3. **Its text misdiagnoses the cause.** It reads "This might be intentional — if you created a composite persona." Under ADR-006 a composite has its own Person record, so that is not what B-many indicates, and there is no longer an intentional case. The message should state plainly that the shape is wrong and name what to fix.

## Alternatives

### Alternative A: Repair once at startup via migration

A single pass fixes every invalid component, applying a deterministic rule.

**Why not chosen**: this is precisely the failure mode filed as GitHub #96 on the same day this decision was made — a startup migration that silently cleared provenance because its predicate did not recognize a reserved value, with no user-visible signal and no reconciliation afterward. A migration that silently picks which of two links survives has the same shape and a worse outcome: #96 lost attribution, this would lose a relationship. The evidence against it was generated by this codebase this week.

### Alternative B: Repair on touch

Leave data alone until something writes that Person or Persona, then apply a rule and log it.

**Why not chosen**: same silent-write property, arriving at a less predictable time. It shares its failure mode with the corrections-drain race accepted in ADR-008 — an effect the user did not request, landing as a side effect of an unrelated action, discoverable only in a log. Editing a nickname should not quietly delete a link.

### Alternative C: Reject the entire write

Any upsert containing an invalid link fails as a whole.

**Why not chosen**: an LLM full-record person update carrying one bad link would discard every legitimate change in the same payload. The rejection is correct in scope but wrong in blast radius.

### Alternative D: Build a conflict-resolution UI

Surface invalid components in the TUI and web with an interactive fix flow.

**Why not chosen**: correct if the shape were common. It is not — it should never occur, and every occurrence is a defect somewhere upstream. Building a resolution flow for it invests in the symptom and, worse, makes the invalid state feel like a supported configuration.

## References

- `docs/adr/ADR-006-ei-persona-link-multiplicity.md` — the cardinality decision this implements
- `docs/adr/ADR-008-accepted-write-races.md` — the silent-write failure mode Alternative B shares
- `.sisyphus/issues/enforce-one-to-one-persona-person-link.md` — the tracked fix, and the full ingress/QA matrix
- [GitHub #96](https://github.com/Flare576/ei/issues/96) — the startup-migration data loss that rules out Alternative A
- `src/core/orchestrators/ceremony.ts:640-655` — the reporting mechanism being reused
- `CONTRACTS.md` — `Ei Persona` type, casing, and link provenance
