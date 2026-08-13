# ADR-037: Extraction and Reducer Prompts Stay Single-Purpose

## Status

Accepted

## Date

2026-08-11

## Context

Ei's prompt library is written for small and/or local models. `person-update.ts`, `topic-update.ts`,
`fact-find.ts`, `event-scan.ts`, and every other extraction builder assume a model that does one
well-specified job per call, not one that reliably tracks branching instructions, in-prompt variables,
or conditional tool-call logic across a single request. Some publicly-shared Skills/prompts written for
Sonnet-grade or Opus-grade models embed exactly that: variables, logic branches, conditional tool
invocations — closer to a small program than a task description.

This surfaced concretely while designing the Persona Emergence Signals feature (GH #97, GH #100),
replacing an append-only Person-record log with attributed `PersonaObservation`/`EmergentSignal`
evidence. The natural first draft of "how does a new `PersonaObservation` find the `EmergentSignal`
it belongs to, and get promoted" reached for one
combined step: classify the observation, decide if it matches an existing signal, and apply promotion
criteria, all in one LLM call. Flare's correction, verbatim: *"take the approach you'll find elsewhere in
this project — One goal per prompt. Give the 'agent' everything it needs to do the one thing. Spell out
what the one thing is, and give it a format to return it. That's why you see the Topic pipeline have 4
steps now (scan, match, update, validate)."*

That four-step shape already exists and is the precedent this ADR names explicitly:
`HandleHumanTopicScan` → `HandleTopicMatch` → `HandleTopicUpdate` → `HandleTopicValidate`
(`src/core/types/enums.ts:30,32-33,53`; handlers in `src/core/handlers/human-extraction.ts`,
`human-matching.ts`, and `HandleTopicValidate`'s mapping to `handleDedupCurate`,
`src/core/handlers/index.ts:12-13,44`). Scan finds candidates in the conversation. Match decides,
against a closed list of existing Topics, whether a candidate is one of them or new
(`handleTopicMatch`, `human-matching.ts:20-63` — resolves `matched_guid` against `human.topics`, then
queues a *separate* Update call rather than writing anything itself). Update synthesizes the actual
field content for whichever Topic (existing or new) the Match step named. Validate runs a distinct
dedup/curation pass afterward as a safety net. Four single-purpose LLM calls, never one call doing all
four jobs.

## Decision

**Every extraction or reducer prompt in this codebase does exactly one job, states that job plainly,
and returns a format shaped for that job alone.** A step that needs to (a) classify something, (b)
match it against existing state, and (c) decide a consequence of that match is three prompts, not one
— mirroring the Topic pipeline's Scan/Match/Update/Validate shape, not a single call carrying
conditional branches, embedded variables, or multi-step tool orchestration.

This governs, going forward, every prompt builder under `src/prompts/`, and specifically resolves how
the Persona Emergence Signals bundle wires `PersonaObservation` → `EmergentSignal`:

1. **Scan/Extract** — the existing extraction pass identifies a Persona-linked Person and extracts one
   or more claims, with attribution already resolved to the true speaker (per that bundle's own
   attribution-resolution requirement) — one job: read the conversation, produce claims. No matching,
   no promotion decision.
2. **Match** — a separate call, shown the Persona's current *open* signals (`candidate` + `recurring`
   only, never `dismissed`) as a closed list with IDs and claim text — mirroring
   `buildPersonaTopicRatingPrompt`'s and `handleTopicMatch`'s own closed-list pattern exactly. One job:
   for each new claim, return an existing signal ID it belongs to, or `"new"`. No promotion math, no
   writing.
3. **Update/Reduce** — deterministic code, not an LLM call: given the Match step's decision, attach the
   new observation as evidence (existing signal) or create a `candidate` (new claim), then run the
   promotion-criteria policy's pure arithmetic (independent-observer counting, dimension-scaled bar) to
   decide candidate→recurring. This step has no prompt at all — it is exactly as mechanical as
   `calculateExposureCurrent`, and for the same reason: a decision that's pure arithmetic over already-
   classified data doesn't need a model in the loop.
4. **Validate** — a dedup/curation safety net over signals for the same Persona, run the same way
   `HandleTopicValidate`/`handleDedupCurate` catches Topics that Match missed, in case near-duplicate
   claims slipped past Match's own decision.

## Alternatives Considered

### Alternative A: One combined classify-match-promote call
- **Description**: A single extraction call that reads the conversation, classifies dimension/lens,
  decides which existing signal (if any) it matches, and applies promotion criteria, all in one
  response.
- **Pros**: Fewer LLM round-trips; conceptually one mental model instead of four.
- **Cons**: Requires the model to hold four distinct jobs — read comprehension, closed-set matching
  against a list it must also be shown, and threshold arithmetic — in one instruction set. This is
  exactly the "prompt as a small program" shape this project has consistently avoided elsewhere, for a
  model class this project is built around (small/local) that doesn't reliably execute it.
- **Why not chosen**: Directly contradicts the established, working Topic pipeline precedent and
  Flare's explicit correction.

### Alternative B: Two calls — combined scan+match, separate update
- **Description**: Fold Scan and Match into one call (extract a claim and immediately decide its
  match against the shown signal list), keep Update/Validate separate.
- **Pros**: Fewer calls than the four-step shape; still separates "decide" from "write."
- **Cons**: Still asks one call to both read free-form conversation text *and* reason over a closed
  list simultaneously — the same class of compound instruction this ADR is rejecting, just smaller.
  The existing Topic pipeline doesn't do this either; Scan and Match are already separate today.
- **Why not chosen**: Inconsistent with the precedent this ADR is codifying, for a marginal call-count
  saving.

### Alternative C (chosen): Four single-purpose steps, mirroring the Topic pipeline exactly
- **Description:** Scan/Extract, Match, Update/Reduce (deterministic, no prompt), Validate — as
  detailed in Decision.
- **Pros**: Directly reuses a working, already-shipped pattern; each prompt is small, spellable, and
  testable in isolation (per `beta-execute`'s own per-scenario testing shape); the Update step needs no
  prompt at all, since it's pure arithmetic once Match has classified the input.
- **Cons**: More LLM round-trips than a combined call.
- **Why chosen**: Flare's own accounting, verbatim: *"it's extra calls, but payload-wise, it's not
  dramatically more. Thinking/Reasoning would probably be more, but for the extraction pipeline, we
  generally disable extra thinking/output, so we mitigate it a bit."* The call-count cost is real but
  small and already paid elsewhere in this codebase for the same reason; the reliability gained back —
  a small/local model executing four plain jobs instead of one compound one — is the actual trade this
  project has made consistently, not a one-off exception for this bundle.

## Consequences

### Positive
- The Persona Observation → Signal reducer has a concrete, buildable execution model instead of an
  implied-but-unspecified "in-stream at write time," and it's the same shape every other extraction
  pipeline in this codebase already uses — no new pattern for a maintainer to learn.
- Match's closed-list-of-existing-signals design directly answers the second half of the gap this ADR
  exists to close: a new observation with free-text claim wording still finds its existing signal via
  the same mechanism Topics already use, not a bespoke embedding-similarity or exact-string scheme
  invented for this one subsystem.
- No new scheduled/ceremony job is introduced — Scan/Match/Update/Validate all run inline, per
  extraction pass, consistent with sunsetting the periodic Reflection Critic rather than reintroducing
  its shape under a new name.

### Negative
- Four round-trips (three LLM calls plus one deterministic step) per newly extracted Persona-relevant
  claim, versus the single call an earlier draft considered. Accepted per Flare's own cost accounting
  above.
- The Match step's closed list is only as good as what's shown to it — a Persona accumulating a large
  number of open signals over time may eventually need the same kind of embedding-based shortlisting
  `human-matching.ts` already uses for Topics (`getEmbeddingService`/`getTopicEmbeddingText`) rather
  than showing the model every open signal unconditionally. Not needed at this bundle's initial scale
  (a Persona's open-signal count is expected to stay small and bounded by the promotion/dismissal
  lifecycle itself), but named here so a future maintainer facing that scale doesn't have to
  rediscover the precedent.

### Risks
- **Enforcement is by convention, not a lint rule.** Nothing mechanically stops a future prompt builder
  from reintroducing a compound, branching, multi-job prompt. The Topic pipeline's own existence as a
  four-file, four-handler precedent is the concrete example to point at during review, not a structural
  guard.

## Reversibility

Moderate. Collapsing the four-step shape back into fewer calls is a local prompt/handler change with no
data migration — the persisted `PersonaObservation`/`EmergentSignal` schema doesn't encode which step
produced which field. What would be lost is the reliability trade this ADR is making, not any
structural investment that's expensive to undo.

## References

- The Topic pipeline (`HandleHumanTopicScan`/`HandleTopicMatch`/`HandleTopicUpdate`/`HandleTopicValidate`,
  `src/core/types/enums.ts:30,32-33,53`) — the precedent this ADR codifies.
- `human-matching.ts:20-63` (`handleTopicMatch`) and `src/prompts/persona/topics-rate.ts` — the
  closed-list-shown-to-the-model pattern the new Match step mirrors.
