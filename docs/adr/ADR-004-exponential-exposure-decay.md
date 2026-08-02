# ADR-004: Exposure Decays Exponentially at K=0.1, Replacing a Logistic Curve

## Status

Accepted

## Date

2026-08-01 — **backfilled.** The decision predates this record. Its original date is not in current source; `git log` on `src/core/utils/decay.ts` would establish it, and has not been consulted.

## Rationale Provenance

**STATED**, for the curve. The reasoning below is recovered verbatim from the source docstring at `src/core/utils/decay.ts:1-13` — including, unusually, an explicit account of the rejected alternative. Nothing is reconstructed.

**UNRECORDED**, for the specific value `0.1`. Current source documents what K=0.1 *does* but not why that number was chosen over a neighbour. This is unread, not lost: the decay implementation has been iterated on about as heavily as the extraction pipeline, so `git blame` and `git log` on this file would very likely show the tuning history. No one has looked, because nothing currently depends on knowing. **Anyone changing K should look first.**

## Context

Exposure values (`exposure_current`) track how recently and frequently a topic or person has come up. They must decay over time, or "we discussed this heavily last month" reads identically to "we are discussing this now."

The *shape* of that decay curve is not a cosmetic choice. It determines which values erode fastest, and therefore what a persona believes is currently salient when it builds a response. A wrong shape produces personas that fixate on stale topics or forget live ones.

An earlier implementation used a logistic approximation. It was replaced.

## Decision

Exponential decay:

```
v(t) = v₀ · e^(−K · days)     K = 0.1, result clamped to [0, 1]
```

Intervals under ~6 minutes are treated as no-ops (`applyDecayToValue`, `decay.ts:33-35`).

Behavior at K=0.1, quoted from source:

> `K=0.1 means ~9.5% decay per day regardless of current value.`
> `Decays fastest immediately after peak, slows as it approaches 0.`
> `A topic at 1.0 reaches ~0.5 after ~7 days, ~0.05 after ~30 days.`

`K` is a parameter, not a constant — callers pass `decay_rate ?? 0.1` (`ceremony.ts:312-329, 389-419`), so the rate is tunable without a code change.

## Alternatives Considered

### Alternative A: Logistic approximation — previously implemented, rejected

- **Description**: `K · v · (1−v) · hours`
- **Why rejected**, quoted from source:
  > `it decayed FASTEST at 0.5, not at 1.0, and was aggressive enough to drop 0.2 → 0 in a single day.`
- **Analysis**: both properties invert the intent. A topic at peak salience eroded slowly while a mid-salience topic evaporated, and anything mildly salient vanished overnight. Decay should be fastest right after a peak and gentlest near zero — which is exactly the property the replacement has.

### No other alternatives are recorded

Linear decay, step decay, and windowed schemes may or may not have been weighed. Source does not say, and this ADR does not speculate.

## Consequences

### Positive
- Decay is fastest immediately after a peak and slowest near zero, matching intent.
- The rate is value-independent, so behavior is predictable across the whole range.
- `K` is already parameterized, so tuning requires no code change.

### Negative
- A ~7-day half-life is a product judgment about how fast attention should fade. Nothing records why that is the right feel.
- The exact value `0.1` has no recorded derivation. It is stated and its *effects* are described, but not justified against `0.08` or `0.15`.

### Risks
- **Tuning `K` silently reshapes what every persona considers salient.** The parameter is easy to change and its blast radius is wide but invisible — no test asserts a particular half-life. Anyone adjusting it should expect persona behavior to shift, not just a number.
- **This curve is scaffolding on a mechanism already decided to be redundant.** A prior decision (2026-05-03, Flare and Sisyphus) resolved to leave the exposure system in place and let it **atrophy naturally**, on the grounds that the RAG tools — `find_memory`, `fetch_memory`, `fetch_message`, plus the quote→topic→message chain — let a persona navigate the knowledge graph on demand and so removed exposure's role as the driver of topic surfacing. Tuning this curve is therefore unlikely to be the right lever for a topic-selection problem; the retrieval path usually is. Reading this ADR alone would suggest exposure is load-bearing. It is not.
- **Three known defects sit upstream of the curve and are not fixed by it.** Recorded in that same prior decision:
  - *Sledgehammer*: `exposure_current` uses `Math.max(target, current)` where `target` maps from the LLM's `high`/`medium`/`low`/`none` assessment, so one passing mention assessed `high` jumps current to `0.9` — identical weight to a twenty-minute deep dive.
  - *Ceiling*: because of those MAX semantics, `current` cannot exceed `0.9` through discussion alone. A topic discussed daily sits at `current: 0.9, desired: 0.5`, a delta of `-0.4`, which reads as "change subject" — the system steers personas **away** from the user's most-discussed topics.
  - *Default and scale*: `exposure_desired` defaults to `0.5` for every Human Topic, and real usage produces 186+ topics where the design assumed 10–15. With everything at the same desired level the delta math is mostly noise.

  No amount of decay tuning addresses any of these; they are properties of the impact→value mapping and the MAX update, not of the curve.

## Reversibility

Easy. Single pure function, already parameterized, no stored state depends on the curve — decay is recomputed from `last_updated` on each pass. Changing the shape again would be a localized edit.

## References

- `src/core/utils/decay.ts:1-22` — formula, constant, and the rejected-alternative docstring
- `src/core/orchestrators/ceremony.ts:312-329, 389-419` — call sites passing configurable `decay_rate`
- `src/core/utils/exposure.ts:3-13` — the impact→value mapping decay operates on. Its numeric mapping (`high=.9 / medium=.6 / low=.3 / none=.1`) has **no** recorded rationale and is a separate open item.

The prior exposure-system decision cited under Risks predates this directory's convention and has not
yet been migrated into it. Its substance is reproduced above rather than referenced, so this ADR does
not depend on it.
