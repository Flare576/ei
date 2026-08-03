# ADR-018: Ceremony Rates Exposure, Never Identity

## Status

Accepted

## Date

2026-08-03

## Context

`PersonaTopic` has seven fields (`src/core/types/data-items.ts:47-57`):

```typescript
export interface PersonaTopic {
  id: string;
  name: string;
  perspective: string;      // Their view/opinion on this topic
  approach: string;         // How they prefer to engage with this topic
  personal_stake: string;   // Why this topic matters to them personally
  sentiment: number;        // -1.0 to 1.0
  exposure_current: number; // 0.0 to 1.0 (how recently discussed)
  exposure_desired: number; // 0.0 to 1.0 (how much they want to discuss)
  last_updated: string;     // ISO timestamp
}
```

`name`, `perspective`, `approach`, `personal_stake`, `sentiment`, and `exposure_desired` are
**constitutive** — they define who the persona is and how much they *want* to engage with a topic.
`exposure_current` is **mechanical** — it tracks how much the topic has actually come up in
conversation. A persona has fewer than ten topics, all user-confirmed at creation time
(`src/core/handlers/persona-generation.ts`, discussed below); nothing about the set of topics or
their constitutive fields is meant to change on its own.

The ceremony's persona-topic pipeline originally didn't respect that distinction. It was copied
from the shape used for *human* topics — `Scan` (find candidate topics in conversation) → `Match`
(check candidates against the existing backlog) → `Update` (write the result) — plus two more
phases, `Expire` (drop topics with low exposure) and `Explore` (invent a new topic from thin air),
built to compensate for a period when persona generation was opaque: the user couldn't see a
persona's topics before saving, so the ceremony grew machinery to fill in and prune them
after the fact. A sixth phase, `DescriptionCheck`, updated a persona's long description the same
way. That shape is wrong for persona topics specifically: they are not *discovered* the way human
topics are (there can be hundreds of those, found incrementally from conversation with no
advance knowledge of what they'll be) — they are a small, closed, user-authored set. Every night,
this pipeline had the authority to silently rewrite `perspective`, `approach`, `personal_stake`,
and `sentiment` based on what got talked about that day, silently kill a topic the user had
deliberately kept (`Expire`), or invent one the user never confirmed (`Explore`). None of that is
identity drift in the abstract — it is the ceremony overwriting explicit, user-confirmed
decisions about who a persona is, without the user seeing or approving any individual change.

Persona generation is no longer opaque: the user reviews and confirms every topic (name,
perspective, approach, personal stake) before it is ever saved. The compensating machinery built
for the old, opaque flow has no remaining job — the one thing that still legitimately varies
day-to-day is how much each already-confirmed topic actually got discussed.

Today, none of `Scan`, `Match`, `Update`, `Expire`, `Explore`, or `DescriptionCheck` exist anywhere
in `src/core`: `queuePersonaTopicScan`/`Match`/`Update`, `handlePersonaTopicScan`/`Match`/`Update`,
`handlePersonaExpire`/`Explore`, `handleDescriptionCheck`, and their corresponding
`LLMNextStep` enum members (`HandlePersonaTopicScan`/`Match`/`Update`, `HandlePersonaExpire`,
`HandlePersonaExplore`, `HandleDescriptionCheck`) are gone. `src/core/types/enums.ts:36` has exactly
one persona-topic-related `LLMNextStep` member: `HandlePersonaTopicRating`.

## Decision

**Ceremony's only channel for touching a persona's topics is a rating pass that may write
`exposure_current` and `last_updated`, and nothing else.** `name`, `perspective`, `approach`,
`personal_stake`, `sentiment`, and `exposure_desired` are permanently read-only from ceremony's
point of view.

This is enforced structurally, by the shape of the one function that runs during ceremony, not by
a guard bolted onto a general-purpose update path:

1. **The prompt is closed-set, not discovery.** `queuePersonaTopicRating`
   (`src/core/orchestrators/persona-topics.ts:32-95`) takes the persona's *existing* `topics` as
   input and embeds all of them, unconditionally, into every chunk (`:64-68`) —
   `{ id, name, description_hint }`, where `description_hint` is the first 80 characters of
   `perspective` (`:67`). There is no scan step that could surface a topic outside this list, and no
   match step that could misfile a rating against the wrong existing topic — the ID is supplied by
   the orchestrator, not inferred by the model.
2. **The prompt itself forbids invention.** `buildPersonaTopicRatingPrompt`
   (`src/prompts/persona/topics-rate.ts:4-95`) states directly: *"Do NOT invent new topics. Do NOT
   analyze deeply. Just rate what you observe"* (`:22`) and *"'none' is the expected answer for most
   topics most days. Only rate higher if there's clear evidence"* (`:40`). The requested output is a
   qualitative `exposure_impact` label (`"none" | "low" | "medium" | "high"`) per topic ID — nothing
   in the response shape carries a `perspective`, `approach`, `personal_stake`, or `sentiment` value
   for the model to propose in the first place.
3. **The handler only ever writes two fields.** `handlePersonaTopicRating`
   (`src/core/handlers/persona-topics.ts:11-68`) maps each returned rating back to its topic by
   `topic_id`, skips it entirely when `exposure_impact === "none"` (`:45-47`), and for everything
   else does:

   ```typescript
   const newExposure = calculateExposureCurrent(rating.exposure_impact, topic.exposure_current);
   return { ...topic, exposure_current: newExposure, last_updated: now };
   ```

   (`:49-56`). Every other field is carried through the object spread unchanged; the function body
   never reads or writes `perspective`, `approach`, `personal_stake`, `sentiment`,
   `exposure_desired`, or `name` anywhere. There is no code path inside this handler capable of
   producing a mutation to those fields — the omission isn't a policy the handler follows, it's the
   entire extent of what the handler does.
4. **Exposure itself only ratchets up.** `calculateExposureCurrent`
   (`src/core/utils/exposure.ts:3-14`) maps `exposure_impact` to a target (`high`→0.9, `medium`→0.6,
   `low`→0.3, `none`→0.1) and returns `Math.max(target, current)` — a quiet day, or a single
   mis-rated `"low"` on a topic that was actually discussed heavily, cannot silently erase exposure
   that accumulated on a better day. This is a property of the mechanical field, not an exemption —
   it doesn't change what may or may not be written, only how the one writable field moves.

The only place `perspective`, `approach`, `personal_stake`, and `sentiment` are ever written for a
`PersonaTopic` — confirmed by search across `src/core` — is `handlePersonaGeneration`
(`src/core/handlers/persona-generation.ts:66-79,83-95`), which runs during persona creation, merging
LLM-suggested topic fields with whatever the user already typed (`userTopic?.perspective?.trim() ||
t.perspective || ''` — user input wins, `:71-73`). That path is reached only through the
user-driven generation/edit flow the user explicitly reviews and saves; ceremony never calls into
it. Constitutive identity fields change exactly once, deliberately, with the user watching — never
as a side effect of a nightly background pass over that day's conversation.

### Current ceremony flow

The ceremony's phase sequence has grown since the persona-topic rating decision landed and now
extends well past where it originally ended. In current source
(`src/core/orchestrators/ceremony.ts`), triggered nightly via `startCeremony` (`:60-90`) and
advanced phase-by-phase by `handleCeremonyProgress` (`:172-293`, itself summarized in the function's
own comment at `:170`: *"Phase 1: Dedup → Phase 2: Expose → Phase 3: EventSummary → Decay → Phase 4:
Person Rewrite → Topic Rewrite (fire-and-forget)"*), the full sequence is:

1. **Dedup** (phase 1) — topic/person migration and dedup work queued ahead of the ceremony proper.
2. **Expose** (phase 2, `:177-237`) — human extraction (`Fact`/`Topic`/`Person` scans) *and* persona
   topic rating (`queuePersonaTopicRating`, called both for 1:1 channels and per-persona in rooms,
   `:224-234`) run here, side by side.
3. **EventSummary** (phase 3, `:245-256`).
4. **Decay / Prune** (`:259-275`) — `applyDecayPhase` and `prunePersonaMessages` run synchronously
   for every active persona, followed by `runHumanCeremony` (decay for human topics and people).
   This is where the plan that introduced persona-topic rating originally described the ceremony as
   ending; it no longer does.
5. **Person Rewrite** (queued as phase 4, `:280`, implemented at `:487-547`) — scans overlong
   `Person` records (not `PersonaTopic`) for extraction into `Topic`s.
6. **Topic Rewrite** (`:239-243`, implemented at `:549-604`) — runs once Person Rewrite's
   phase-4 items complete; scans overlong `Topic` records the same way.
7. **Reflection** (`:288-289`, implemented at `:621-693`) — fired fire-and-forget alongside Person
   Rewrite in the same phase transition, queuing a critic pass over each linked persona's `PersonLog`
   once it exceeds `PERSON_LOG_REFLECTION_THRESHOLD` (`:22`).

Person Rewrite, Topic Rewrite, and Reflection operate on `Person`, `Topic`, and `PersonLog` — none
of them touch `PersonaTopic` at all, so this decision's invariant holds across the entire current
flow, not just the Expose phase where the rating pass lives.

## Alternatives Considered

### Alternative A: Patch the existing `Update` handler to skip identity fields
- **Description**: Keep `Scan` → `Match` → `Update` as-is; just stop the `Update` handler from
  writing `perspective`/`approach`/`personal_stake`/`sentiment`.
- **Pros**: Smallest possible diff; `Scan`/`Match` continue to exist unchanged.
- **Cons**: `Scan` and `Match` exist to support open-ended discovery against an unbounded backlog —
  a shape persona topics never had. Keeping them means keeping an LLM call that can still propose a
  new topic name or match a rating to the wrong existing topic, for no benefit, since the actual
  output ceremony needs (an exposure rating against a known ID) doesn't require discovery or
  matching at all.
- **Why not chosen**: Removes the risky *write*, not the risky *shape*. A handler that already has
  the full topic object in scope, with `Update` already in its name, is exactly the kind of place a
  later change re-adds "while we're in here, also update `sentiment`."

### Alternative B: Add a runtime/schema guard rejecting identity-field writes, keep `Scan`/`Match`/`Update`
- **Description**: Leave the borrowed Human-topic pipeline intact; add an explicit allowlist check
  (or a `readonly` marker respected only by a lint rule) that throws if ceremony code attempts to
  write a constitutive field.
- **Pros**: Defense in depth if a future change tries to add a write.
- **Cons**: Persona topics still don't need `Scan`/`Match` at all — the guard would be permanent
  scaffolding wrapped around a pipeline shape that never fit this data. It also doesn't remove
  `Expire`/`Explore`, whose entire purpose (drop a topic, invent a topic) is themselves the risk,
  not just a wayward field write inside them.
- **Why not chosen**: Polices a wrong shape instead of replacing it. The chosen design makes the
  violation structurally unrepresentable (the rating handler has no code path that reaches those
  fields) rather than structurally possible but checked.

### Alternative C: Keep `Expire`/`Explore` but require explicit user confirmation before applying
- **Description**: Nightly-compute a "this topic has had near-zero exposure for a while, consider
  removing" or "here's a topic candidate from conversation" proposal, surfaced to the user for
  approval rather than applied automatically.
- **Pros**: Preserves some automatic "topic hygiene" signal without unilateral mutation.
- **Cons**: Persona generation already gives the user a transparent, reviewed moment to add, edit,
  or drop topics — `Expire`/`Explore` were built specifically to compensate for a time when that
  moment didn't exist. Reintroducing a parallel nightly-proposal flow duplicates that moment for no
  new capability, and reopens the same "low exposure → consider removing" signal the current
  design explicitly rules out.
- **Why not chosen**: The problem `Expire`/`Explore` solved (opaque generation) no longer exists;
  a confirmation gate on top of them treats the symptom (unilateral action) rather than removing
  machinery that has no remaining purpose.

### Alternative D: Treat persona topics like human topics — keep open-ended `Scan`/`Match` discovery
- **Description**: Do nothing; leave the original borrowed pipeline in place on the premise that
  more automatic detection is strictly more capability.
- **Cons**: This is the design being replaced. It conflates two genuinely different kinds of data —
  human topics (discovered, unbounded, no advance knowledge of what exists) and persona topics
  (constitutive, closed, user-authored, fewer than ten) — and gives conversation-driven code the
  same authority over both, which is exactly how a persona's stated perspective on a topic could
  silently reshape itself around whatever came up that day.
- **Why not chosen**: The two data shapes aren't actually analogous; borrowing the human pipeline
  wholesale was the original mistake this decision corrects.

## Consequences

### Positive

- The invariant is structural, not policed: `handlePersonaTopicRating`'s body contains no code path
  that reads or writes `perspective`/`approach`/`personal_stake`/`sentiment`/`exposure_desired`/
  `name` — there is nothing to bypass, disable, or forget to re-check later, unlike a guard that
  could be quietly removed.
- The closed, ID-supplied topic list eliminates an entire class of failure that existed in
  `Scan`/`Match`: the model can no longer invent a topic name or misroute a rating to the wrong
  existing topic, because it never chooses the topic — it only labels exposure against IDs the
  orchestrator already supplied.
- `exposure_current`'s `Math.max`-based ratchet means the one writable field is resilient to a bad
  single-day rating; identity fields carry no such compounding risk in the first place because
  ceremony can't touch them at all.
- Identity change happens exactly once, deliberately, with the user reviewing and confirming it
  (persona generation) — never as an emergent side effect smeared across nightly automatic passes
  the user never individually sees or approves.

### Negative

- There is no automatic path left for a persona's genuine `perspective`/`approach`/`personal_stake`
  to evolve from years of conversation, even where that evolution would be organic and desirable —
  it now requires the user to deliberately return to persona editing. This is an intentional
  trade (push the burden onto deliberate action instead of silent drift), but it is a real loss of
  a capability the old pipeline had, however unsafely.
- `exposure_desired` is now permanently static after creation. A persona's *desire* to discuss a
  topic can't organically grow or shrink from the fact that the topic keeps coming up (or
  doesn't) — the design explicitly rules out any "current exposure informs desired exposure" signal.
- The rating pass's closed topic list means a durable new interest that emerges purely from
  conversation is never promoted into a real topic automatically — new topics come from user action
  only. If a user wants ceremony-observed conversation patterns reflected as a new topic, that
  requires the user to notice and add it themselves; there is no assistive nudge.

### Risks

- **Enforcement lives in one function's implementation, not the type system.** `PersonaTopic`'s
  fields are not marked `readonly`, and nothing in the type layer prevents a different, future
  write path from calling `state.persona_update(personaId, { topics: [...] })` with a modified
  `perspective`. A regression that reintroduces ceremony-driven identity writes through a new call
  site — rather than through `handlePersonaTopicRating` itself — would compile cleanly and require a
  code reviewer, not a type checker, to catch it.
- **The "closed set, fewer than ten topics" premise is a design assumption, not an enforced
  invariant.** If personas eventually accumulate topic lists large enough that embedding all of
  them in every rating chunk becomes impractical, the reasoning that made `Scan`/`Match`
  unnecessary would need re-examination — though because the old phases were deleted rather than
  disabled, that would mean designing new machinery, not just re-enabling something dormant.
- **`last_updated` is not a provenance signal.** `handlePersonaTopicRating` bumps a topic's
  `last_updated` on every exposure change (`persona-topics.ts:55`), the same timestamp field that
  would move if `perspective` ever were mutated by some other path. A topic's `last_updated` being
  recent tells a reader nothing about *which* field actually changed — recency alone cannot be used
  later to audit whether an identity field was touched.

## Reversibility

Moderate. The mechanism itself is easy to change going forward: `handlePersonaTopicRating` already
resolves the full topic object and returns a new copy of it, so widening what it writes is a small,
local diff. What is not cheap is restoring the deleted machinery — `Scan`, `Match`, `Expire`,
`Explore`, and `DescriptionCheck`, along with their prompt builders and enum members, no longer
exist in the codebase; reinstating any of them means rewriting them from scratch, not re-enabling
disabled code. There is also no way to retroactively distinguish, for any topic written under this
regime, whether its `perspective`/`approach`/`personal_stake` reflect the user's original
creation-time input or (hypothetically) a value written by some other path, since `last_updated` is
shared with exposure changes and carries no per-field provenance.

## References

- `src/core/types/data-items.ts:47-57` — `PersonaTopic`, the constitutive vs. mechanical field split
- `src/core/orchestrators/persona-topics.ts:32-95` — `queuePersonaTopicRating`, the closed-set,
  ID-supplied rating queue
- `src/core/handlers/persona-topics.ts:11-68` — `handlePersonaTopicRating`, the only ceremony write
  path for `PersonaTopic`, writing exactly `exposure_current` and `last_updated`
- `src/prompts/persona/topics-rate.ts:4-95` — `buildPersonaTopicRatingPrompt`, the no-invention,
  "none is expected" prompt contract
- `src/core/utils/exposure.ts:3-14` — `calculateExposureCurrent`, the `Math.max`-ratcheted exposure
  target function
- `src/core/handlers/persona-generation.ts:66-79,83-95` — `handlePersonaGeneration`, the sole,
  creation-time, user-confirmed write path for `perspective`/`approach`/`personal_stake`
- `src/core/types/enums.ts:36` — `HandlePersonaTopicRating`, the sole persona-topic
  `LLMNextStep` member
- `src/core/orchestrators/ceremony.ts:60-90,170-293,454-694` — `startCeremony`,
  `handleCeremonyProgress`, `queuePersonRewritePhase`, `queueTopicRewritePhase`,
  `queueReflectionPhase` — the full current ceremony phase sequence
- `CONTRACTS.md:517` — changelog entry recording the original 2026-04-05 simplification (historical;
  its "ends at Decay" description of the flow has since been superseded by Person Rewrite, Topic
  Rewrite, and Reflection, as described above)
