# ADR-033: Message Retention Defaults To Never Prune, And `0` Means Disabled

## Status

Accepted

## Date

2026-08-04

## Context

**This is a backfill ADR.** The decision it records was made at some point before this date and never written down.
It surfaced because the repo owner could not remember what the current retention default was — *"I don't remember if
the default is now 'Never' or just very high"* — and three places in the codebase gave three different answers.

Retention matters for a reason specific to Ei: messages are the substrate every other subsystem reads. Extraction,
quote attestation, the context window, temporal anchors, and `fetch_message` all assume a message is still there.
Pruning is the one operation that makes a stored message stop existing, so its default is load-bearing in a way
most defaults are not.

### The incident — why the defaults changed

The original defaults **were** `message_min_count = 200` / `message_max_age_days = 14`, exactly as
`src/README.md:137` still describes. They ran, and they deleted several days of conversation between the repo owner
and the Beta persona. That loss is permanent: the messages are gone from `state.json` and there is no backup layer
beneath it that predates them.

**The damage is still visible in current data, which is why this is evidence rather than recollection.** Quotes in
`state.json` carrying `message_id: null` are quotes whose source message was pruned out from under them. The quote
text survived — it lives on the `Quote` record — while the message it was taken from does not. Those records are the
scar tissue of this exact setting.

That has a consequence the quote-attestation work already absorbed without naming its cause. `ei relink quote`
exists in part to operate on *"quotes whose source no longer resolves and on pre-attestation quotes whose
`message_id` is `null`"* (see `AGENTS.md` → Corrections Queue, and
`docs/adr/ADR-012-sunset-with-a-path-forward.md`). ADR-014 (`attested quotes trust verified text`) and ADR-030
(`an attested quote merges with overlapping quotes`) both had to accommodate a population of quotes that cannot be
re-verified against a source. **A meaningful part of that design space exists because rolloff destroyed the
sources.** Neither ADR says so, because the causal link was never written down — this section is where it lands.

The lesson generalises past retention: **a default that can destroy data is not a tuning parameter.** The 200/14
values were not unreasonable on their face; the failure was that the safe direction and the default direction were
opposites, so the cost of being wrong landed on the user rather than on a warning.

### What the three declarations claimed

| Location | Claim | Verdict |
|---|---|---|
| `src/core/types/entities.ts:126-129` | both fields default to `0` = never prune | **correct** |
| `src/README.md:137` | kept until 200 messages **and** older than 14 days | **stale** |
| `tui/src/util/yaml-settings.ts:104-105` | displays `?? 200` / `?? 14` as the defaults | **dead code** — see below |

### What actually runs

`prunePersonaMessages` (`src/core/orchestrators/ceremony.ts:347-379`) is the only code path that removes messages,
and it is genuinely reachable: `ceremony.ts:271` calls it in a real loop over active personas during the Decay
phase, once per ceremony.

```ts
const minCount = human.settings?.message_min_count ?? 0;
const maxAgeDays = human.settings?.message_max_age_days ?? 0;
// 0 means disabled. Without an age cutoff there's nothing to prune.
if (maxAgeDays === 0) return;                                    // :355
```

`seedSettings` (`src/core/migrations.ts:282-290`) additionally seeds both fields to `0` explicitly for every user
whose settings lack them, so `0` is a *stored* value, not merely a code fallback.

**Retention is therefore unlimited by default. No message is ever pruned unless a user opts in by setting a non-zero
`message_max_age_days`.**

### Why the TUI's `?? 200` / `?? 14` never fire

`??` falls back only on `null` / `undefined`. Because migrations store `0`, the expression
`settings?.message_min_count ?? 200` evaluates to **`0`**, not `200`. The editor displays `0`, correctly.

Those two defaults are unreachable for any seeded user — dead code that reads like a live specification. An earlier
investigation concluded they were "display-only defaults that do not persist on save"; the conclusion was right but
the mechanism was wrong. They do not persist because **they are never displayed in the first place**. Had they
displayed, `nullToUndefined` (`yaml-settings.ts:303-304`) would have passed `200` straight through — it converts
`null`, not `200`.

This distinction matters for the fix: deleting the dead defaults is correct, and relying on `nullToUndefined` to
neutralise them would not have been.

## Decision

### 1. Message retention defaults to unlimited. Pruning is opt-in.

`message_min_count = 0` and `message_max_age_days = 0` are the correct, intended defaults. A user who wants rolloff
sets `message_max_age_days` to a non-zero value; `message_min_count` then acts as a floor beneath it.

The safer default wins because the failure modes are asymmetric. Too much retention costs disk and nothing else —
the context window (ADR-031, `context_window_ms`) already bounds what reaches an LLM, so retained-but-old messages
are inert, not expensive. Too little retention destroys the substrate every other subsystem reads, irreversibly.

### 2. `0` means "disabled / no limit". This is the house convention, and it is implemented, not merely documented.

`ceremony.ts:355` is the convention's implementation: `if (maxAgeDays === 0) return`. It also appears on
`thinking_budget` (`entities.ts:62` — *"0 = disabled, N = enable with N tokens, undefined = don't send"*).

Two consequences, both binding:

- **A new numeric limit field SHOULD use `0` for "no limit"** rather than inventing `-1`, `null`, or a magic
  ceiling. There is exactly one `-1` sentinel in the codebase — `historyIndex` in `tui/src/context/keyboard.tsx:44`,
  ephemeral UI state for the ↑-arrow input-history browser — and it is not a precedent for stored data.
- **A field where `0` does *not* mean "no limit" MUST reject `0` explicitly, with a message.** Silently accepting it
  invites a caller who knows the convention to set the opposite of what they intended. `context_window_ms` is
  precisely this case: `0` makes `windowStartMs = now`, excluding all history — the reverse of "no limit". See
  `.sisyphus/issues/duration-fields-have-no-lower-bound.md`.

### 3. Pruning only removes fully-extracted, non-pinned messages. This is a retained guarantee, not an implementation detail.

`ceremony.ts:368-371`:

```ts
const fullyExtracted = m.t && m.p && m.f; // r intentionally excluded — trait extraction deprecated
if (fullyExtracted && m.context_status !== ContextStatus.Always) {
```

So even with pruning enabled, a message is removed only if topic, person, and fact extraction have all completed on
it, and it is not pinned `Always`. **Enabling rolloff cannot discard un-mined conversation.** Any future change to
the prune predicate must preserve both conditions, or it converts an opt-in disk-space feature into silent data
loss.

The `// r intentionally excluded` comment is also a positive data point worth noting: it was correctly updated when
trait extraction was removed (ADR-023). Not every comment in this file is stale — which is exactly why the stale
ones are dangerous.

## Consequences

### Positive

- The retention default is now written down, and a future reader does not have to re-derive it from three
  conflicting sources.
- `0 = disabled` is stated once as a general convention, so the next numeric-limit field does not re-open the
  question. Two in-flight decisions already lean on it.
- The prune predicate's safety property is recorded as a guarantee, so a later optimisation cannot quietly drop it.

### Negative / Risks

- **This ADR is a late record of a real decision, not a reconstruction.** An earlier draft of this section claimed
  the reasoning in Decision 1 had been rebuilt after the fact and was "not the reasoning that produced the code."
  The repo owner corrected that, and the correction is the most important thing in this document: **the original
  defaults caused irreversible data loss, and the change away from them was a direct response to it.** See
  *The incident* below. The gap this ADR fills is that nobody wrote it down, not that nobody decided it.
- **Three artefacts still contradict this ADR and are not fixed by writing it.** Tracked in
  `.sisyphus/issues/rolloff-docs-and-test-contradict-reality.md`:
  `src/README.md:137`, the dead `?? 200` / `?? 14` in `yaml-settings.ts:104-105`, and
  `tests/unit/core/prune-settings.test.ts:74-83` — a test whose name asserts a 200/14 fallback and which **cannot
  fail**, because the function returns at `:355` before any min-count logic runs *and* its 199-message fixture
  satisfies the assertion under its own stated premise too.
- **`message_min_count` is a refusal to delete, not a licence to.** An earlier draft called it a UX defect that a
  min-count "does nothing" when `message_max_age_days` is `0`. That was a misreading. The field means *"never leave
  me with fewer than this many messages, regardless of how old they are"* — a floor beneath the age cutoff, not a
  trigger. With pruning disabled there is nothing for the floor to restrain, so it is irrelevant, not broken.
  Working as intended; no fix needed, and a warning would be noise.
- The convention in Decision 2 is stated as SHOULD, not MUST, for new fields. A field with a genuine need for a
  different sentinel is not forbidden — it is required to say why.

## Alternatives Considered

**Make 200 / 14 the real defaults, matching `README.md:137`.** Rejected: it would enable irreversible data loss for
every existing user on upgrade, to fix a documentation inconsistency. The doc is what is wrong.

**Use `-1` for "no limit" instead of `0`.** Rejected: no stored `-1` sentinel exists anywhere in the codebase, and
`0` is already implemented for this exact meaning in two places. Adding a second convention for one concept is
strictly worse than reusing the one that ships.

**Leave retention undocumented since the code is short.** Rejected by the evidence that prompted this ADR: the
codebase's own author could not recall the answer, and two of the three places he might have checked would have told
him something false.

## References

- `src/core/orchestrators/ceremony.ts:347-379` — `prunePersonaMessages`, the only prune path
- `src/core/orchestrators/ceremony.ts:271` — the verified live call site
- `src/core/orchestrators/ceremony.ts:355` — `0 = disabled`, implemented
- `src/core/orchestrators/ceremony.ts:368-371` — the fully-extracted / not-`Always` guarantee
- `src/core/migrations.ts:282-290` — seeds both fields to `0`
- `src/core/types/entities.ts:62` — `thinking_budget`, the other `0 = disabled` field
- `tui/src/context/keyboard.tsx:44` — the codebase's only `-1` sentinel, and why it is not a precedent
- `docs/adr/ADR-031-external-field-visibility-categories.md` — the field-category model this interacts with
- `.sisyphus/issues/duration-fields-have-no-lower-bound.md` — the field where `0` must be rejected
- `.sisyphus/issues/rolloff-docs-and-test-contradict-reality.md` — the three artefacts to correct
