# ADR-008: Two Last-Write-Wins Races Are Accepted, Not Fixed

## Status

Accepted

## Date

2026-08-01

## Context

Ei has no locking, versioning, or conflict detection on entity writes. Two paths can therefore lose a write, and both were found while building the external-reflection opt-out. Neither is being fixed. This record exists so that is a decision someone made rather than something nobody noticed.

Both share a shape: a reader takes a snapshot, something else writes, then the reader writes back a record built from the stale snapshot. Classic last-write-wins. What differs is the size of the window, and the two are **not** comparable.

### Race 1 — the corrections drain, ~100 ms

External writes go through a corrections queue rather than straight to `state.json`, deliberately, to avoid racing the live instance's debounced saves. `writeCorrection` appends and returns; the live Processor drains on its run loop, roughly every 100 ms.

CLI reads overlay queued-but-undrained corrections, so a write is visible to a subsequent read immediately. A **handler**, though, reads live `StateManager` — which does not have the correction until the drain lands.

Concretely, for the opt-out: the reflection skill writes `external_reflection_only: true`, reads it back, sees `true`, and reports a protected run. If a Reflection critic was already dispatched, its callback invokes the handler directly, before the next drain. The handler checks the flag against live state, still sees `false`, and clears the PersonLog.

The handler-time check is correct and does the right thing the moment the flag is actually visible to it. The exposure is the drain interval.

### Race 2 — read-modify-write across an LLM call, seconds

Extraction reads an entity, sends it to an LLM, and writes back a record built from what it read. If a user edits that same entity while the call is in flight, the LLM's write overwrites the edit.

**This window is not 100 ms.** It is the LLM round trip — seconds, sometimes tens of seconds. That is three to four orders of magnitude wider than Race 1, and anyone weighing whether to fix this later should have the real number rather than an inherited "sub-100ms" framing.

It also runs in both directions. A correction drained on top of an entity a handler modified *after* the correction was queued will overwrite that modification, because corrections apply as full-record replacements.

## Decision

**Accept both. Document both. Fix neither.**

Race 1 is a ~100 ms window on a one-time user action — enabling a flag, immediately before running a workflow. Closing it means either teaching handlers to consult the corrections queue, or giving the CLI a way to observe live-state application, or exempting this one write from the queue. Each puts real machinery into a subsystem whose whole purpose was to *avoid* coordinating with the live instance.

Race 2 is wider but needs a user and an extraction to touch the same entity within the same call. Closing it means optimistic concurrency — a version or timestamp on every entity, checked on write — which is a data-model change touching every write path in the system.

Ei is local-first and single-user. The population that can hit either race is one person, racing themselves, on one machine. The cost of the machinery exceeds the cost of the outcome.

**Both are open to contribution.** A PR closing either is welcome; this record is a statement of priority, not of impossibility.

## Alternatives Considered

### For Race 1

- **Handler consults pending corrections.** Closes it wherever it appears. Puts queue-awareness into handlers that currently know nothing about the queue, and invites the same question for every other handler.
- **Skill polls until the flag is visible to live state.** No core change, but the CLI has no way to observe live state — the overlay is exactly what makes the read succeed early. Would need a new "is this applied" signal.
- **Opt-out write bypasses the queue.** Smallest change at the point of use. Carves an exception into the architecture whose reason for existing is to not race the live instance.

### For Race 2

- **Optimistic concurrency.** A version field checked on write, rejecting stale updates. The correct general answer, and a change to every entity and every write path.
- **Narrow the read-modify-write window.** Re-read immediately before writing rather than using the snapshot sent to the LLM. Cheaper, and shrinks the window without closing it — the re-read and the write are still not atomic.

The second is genuinely tempting and was not rejected on merit; it is simply larger than the problem currently justifies. It is the obvious first move if this ever does get fixed.

## Consequences

### Positive
- No locking, no versioning, no queue-awareness leaking into handlers. The corrections architecture keeps its single responsibility.
- The decision is written down, so the next person to find one of these knows it was weighed rather than missed.

### Negative
- Both races remain. A user who hits one loses a write with no error and no indication anything happened.
- The reflection skill can honestly report a "protected run" that is, for up to ~100 ms, not yet protected.

### Risks

- **Silence is the whole problem.** Neither race produces an error, a warning, or a log line. A lost write is indistinguishable from a write that never happened, which makes it near-impossible to diagnose from a user report. If either is ever reported in the wild, expect the report to be "it didn't save" with no reproduction.

- **The accepted scope is single-user and local-first.** Both justifications rest on that. Anything that changes it — a shared instance, a sync path that applies remote writes concurrently, a daemon serving several clients — invalidates this record rather than merely stretching it. Revisit here first.

- **Race 2 will get wider, not narrower.** Its window is the LLM round trip. Larger models and longer tool loops both grow it. The reasoning holds today because collisions need simultaneity; that argument weakens as the window grows.

## Reversibility

Easy for Race 1 — the fix directions above are additive and localized. Harder for Race 2: optimistic concurrency means a field on every entity and a check on every write, and retrofitting it is meaningfully more work than having built it in. Nothing here forecloses either.

## References

- ADR-007 — the opt-out whose protected-run promise is what makes Race 1 user-visible
- `src/cli/corrections-writer.ts` — the append-and-return write
- `src/cli/retrieval.ts` — the read overlay that makes a queued correction visible early
- `src/core/processor.ts` — the drain, and the direct handler dispatch that can precede it
