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

It also runs in both directions. A correction drained on top of an entity a handler modified *after* the correction was queued will overwrite that modification, because corrections apply as full-record replacements. (As of 2026-08-02 that is no longer true of every correction — see the dated note below.)

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

## Note (2026-08-02): "full-record replacements" no longer describes every correction

Race 2's second direction above rests on the premise that *corrections apply as full-record replacements*. That premise is now narrower than when this was written, and a reader reasoning about the reverse direction needs the current shape.

Quote corrections were split into four dedicated ops — `quote.create`, `quote.fix`, `quote.relink`, `quote.remove` (see `CONTRACTS.md` → Corrections Queue → Quote write path). Only `quote.create` still applies as a full-record replacement. `quote.fix` carries a full record on the wire, but its dispatcher overlays only `text`, `start`, `end`, and `embedding` from it, taking every other field — links, `message_id`, speaker, channel, timestamp, `created_at`/`created_by` — from the record already in state at apply time. `quote.relink` carries `id`, `data_item_ids`, and `attempt_id`; `quote.remove` carries `id` alone. Those three are partial by construction, precisely so none can be a vehicle for asserting text or provenance that nobody verified. An op cannot overwrite a field it does not apply, so Race 2's reverse direction does not touch `relink` or `remove` at all, and reaches only the four text/span/embedding fields of a `fix`.

This narrows the exposure; it changes neither decision. Fact, topic, person, and persona corrections are still full-record `upsert`s, and so is `quote.create`, so Race 2 is unchanged for every op that applies a whole record. A `quote.fix` queued against a stale snapshot can still clobber a concurrent text or offset edit — just nothing beyond those four fields. Race 1 is unchanged in every case — the drain interval is a property of the queue, not of the record shape.

One related mechanism is worth recording here because it is easy to mistake for a fix: `quote.create`, `quote.fix`, and `quote.relink` each carry a caller-minted `attempt_id` (`quote.remove` does not — its record is `{op, entity_type, id}` and nothing else), and each of the three correction consumers echoes it back on any record it declines. That exists so a CLI/MCP caller can distinguish *its own* declined write from an unrelated one after a self-drain, and it is what lets `ei relink quote` report an unconfirmed result instead of a fabricated success. It reports the disposition of one queued record. It is not optimistic concurrency, it does not detect a competing write, and it closes neither race.

## References

- ADR-007 — the opt-out whose protected-run promise is what makes Race 1 user-visible
- `src/cli/corrections-writer.ts` — the append-and-return write
- `src/cli/retrieval.ts` — the read overlay that makes a queued correction visible early
- `src/core/processor.ts` — the drain, and the direct handler dispatch that can precede it
