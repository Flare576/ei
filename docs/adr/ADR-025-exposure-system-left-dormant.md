# ADR-025: The Exposure System Is Left Dormant, Not Removed

## Status

Accepted

## Date

2026-08-03 — **backfilled.** The decision itself was made 2026-05-03 by Flare and Sisyphus, before
this directory existed. This record reproduces that conversation's substance and verifies its
claims against current source; it does not re-litigate the decision.

## Rationale Provenance

**STATED**, for the three defects in the exposure→topic-surfacing mechanism (sledgehammer, ceiling,
default/scale — see Context). Each is independently verifiable in current source, not just asserted:
the MAX-semantics clamp is literally `Math.max(target, current)` in
`src/core/utils/exposure.ts:3-13`; the `0.5` default for `exposure_desired` is hard-coded at no fewer
than six call sites (`src/cli/corrections-endpoints.ts:104-105,123-124`,
`src/core/handlers/dedup.ts:255`, `src/core/handlers/heartbeat.ts:164`,
`src/core/handlers/human-matching.ts:151,327`, `src/core/handlers/persona-generation.ts:76,93`); and
the gap-driven surfacing that produces the ceiling effect is live in
`src/core/heartbeat-manager.ts:106,145-149,167-171` and
`src/core/prompt-context-builder.ts:156,198,302`.

**STATED**, for the claim that RAG retrieval tools now exist and can substitute for
Exposure-as-driver. `find_memory`, `fetch_memory`, and `fetch_message` are registered, working tool
executors (`src/core/tools/index.ts:31,54,73`, `src/core/tools/builtin/find-memory.ts:28`,
`src/core/tools/builtin/fetch-memory.ts:24-44,48`, `src/core/tools/builtin/fetch-message.ts:54`), and
the quote→topic/person/fact→message chain both tools rely on is implemented
(`src/core/tools/builtin/fetch-memory.ts:24-44` and `src/core/tools/builtin/find-memory.ts:85-97`
resolve a quote's `data_item_ids` to named linked items; `src/cli/retrieval.ts:134-135,213-214`
defines and populates the same `linked_items` shape for the CLI/MCP surface).

**UNRECORDED**, for the effort/value judgment that removal "would take a week for zero
user-visible improvement." Nothing in current source estimates removal cost or measures
user-visible impact of the current mechanism; this was a judgment reached in the original
conversation between Flare and Sisyphus and is not independently re-derivable from code. It is
recorded here as the stated reason for the decision, not verified.

**UNRECORDED**, for the specific figure "186+ topics against a design that assumed 10-15." This
was a real-usage observation made at decision time (2026-05-03) against live user data this record
has no access to and does not re-query. The *mechanism* it illustrates (a single `0.5` default
applied uniformly regardless of topic count) is STATED and verified above; the specific count is
not re-verified and should be treated as a historical data point, not a current measurement.

## Context

The Exposure system — `exposure_current`, `exposure_desired`, and exponential decay between them —
was not designed for topic surfacing at all. It was originally built to solve a problem that does
not fully exist yet in this codebase: haptic-feedback throttling for a VR/biometric companion
concept, framed as a "hunger gauge" — suppress a persona from over-stimulating a user on a given
topic, let the signal decay naturally, and let it re-emerge once the gap between desired and
current engagement is large enough.

It was later repurposed, unchanged in shape, into the general "what should we talk about
unprompted?" mechanism for heartbeats and responses. `exposure_desired` encodes how often a topic
*should* come up unprompted; `exposure_current` tracks how recently/intensely it has actually come
up; the gap between them is the surfacing signal. This repurposing is still exactly how the code
works today: `heartbeat-manager.ts` filters people and topics where
`exposure_desired - exposure_current > engagementGapThreshold` (0.2) and sorts by that gap
(`heartbeat-manager.ts:106,145-149,167-171`), and `prompt-context-builder.ts` builds
`interested_topics` the same way for the response-building path (`prompt-context-builder.ts:156,
198,302`).

**Three compounding defects make this mechanism unreliable as a driver, all still present and
unchanged in current source:**

- **The sledgehammer problem.** `exposure_current` is updated with MAX semantics:
  `calculateExposureCurrent` maps an LLM-assessed `high`/`medium`/`low`/`none` impact to a target
  value (`0.9`/`0.6`/`0.3`/`0.1`) and returns `Math.max(target, current)`
  (`src/core/utils/exposure.ts:3-13`). A single passing mention assessed `high` jumps `current` to
  `0.9` — identical weight to a twenty-minute deep dive on the same topic. Intensity and duration
  are collapsed into one clamp.
- **The ceiling problem.** Because of that same MAX semantics, `current` cannot exceed `0.9` through
  discussion alone — there is no path in `exposure.ts` to push it past the `high` target. A topic
  discussed daily settles at `current: 0.9`, and with `desired` defaulted to `0.5` (see below), the
  gap `desired - current = -0.4` reads as strongly *not* wanted. The heartbeat and response-context
  filters above are gap-driven, so this mechanism actively steers a persona away from the topics
  the user discusses most — the opposite of the intended effect.
- **The default/scale problem.** `exposure_desired` defaults to `0.5` for essentially every new
  Human Topic and Person, hard-coded at every creation path: the corrections schema
  (`src/cli/corrections-endpoints.ts:104-105,123-124`), dedup-created additions
  (`src/core/handlers/dedup.ts:255`), heartbeat-driven topic updates
  (`src/core/handlers/heartbeat.ts:164`), extraction/matching
  (`src/core/handlers/human-matching.ts:151,327`), and persona-topic generation
  (`src/core/handlers/persona-generation.ts:76,93`). The Birthday-Cake-model intuition behind this
  design assumed a curated set of 10-15 meaningful topics per persona, where a shared default is a
  reasonable starting point pending manual tuning. Real usage at decision time had already produced
  186+ Human Topics (see Rationale Provenance — this specific count is not re-verified here). With
  everything defaulted to the same `desired` level, the delta math the surfacing filters depend on
  is mostly noise rather than signal.

**What changed the calculus: RAG retrieval tools.** Three tools —
`find_memory`, `fetch_memory`, and `fetch_message` — plus the quote→topic/person/fact→message chain
did not exist when Exposure was designed and now do
(`src/core/tools/index.ts:31,54,73`; executors at `find-memory.ts:28`, `fetch-memory.ts:24-44,48`,
`fetch-message.ts:54`). A persona no longer needs Exposure to decide "now is a good moment to bring
up Birthday Cake" — it has Persona Topics (co-authored, explicitly meaningful, distinct from Human
Topics) and can pull recent message context and linked quotes on demand via these tools if a topic
is actually relevant. This makes Exposure redundant *as a driver*: the mechanism that was necessary
before on-demand retrieval existed is no longer the only — or the best — path to the same behavior.

**What still has independent value, orthogonal to this decision:** `last_mentioned` already exists
on every `DataItemBase`-derived record, including `Topic` and `Person`
(`src/core/types/data-items.ts:14`, set by extraction only), and is a plain recency signal
independent of the current/desired apparatus. The `sentiment` field on topics and people is also
unaffected and not implicated here.

## Decision

**Do not remove the Exposure system now.** The mechanism still runs exactly as designed —
`applyDecayPhase` decays every Persona Topic's `exposure_current` each ceremony cycle
(`src/core/orchestrators/ceremony.ts:299-341`), `runHumanCeremony` does the same for Human Topics
and People (`ceremony.ts:385-430`), and the heartbeat/response-context gap filters described above
still read the result. Surgery to excise it — the type fields, every default site, the ceremony
decay phases, the heartbeat/context gap filters, and the prompts that ask the LLM for
`exposure_impact`/`exposure_desired` — is real, multi-file effort for a system with no isolated
seam, and would produce no improvement a user could observe today. The RAG tools already provide
the "what's relevant right now" capability Exposure was standing in for; nothing currently depends
on Exposure being removed to work correctly.

**Leave it in place and let it atrophy naturally.** As the RAG-driven approach proves itself in
practice, the Exposure-driven surfacing behaviors described above will become obviously
unnecessary, and the removal can happen cleanly and confidently at that point — deferred, not
declined.

**One addition was flagged as worth considering, and remains unimplemented today:** a lightweight
`last_discussed` timestamp on `PersonaTopic`, giving heartbeat topic selection a real
longest-without-mention signal without touching the current/desired math at all. Verified against
current source: `PersonaTopic` has no such field —
its full field set is `id`, `name`, `perspective`, `approach`, `personal_stake`, `sentiment`,
`exposure_current`, `exposure_desired`, and `last_updated`
(`src/core/types/data-items.ts:47-57`), and no commit since the 2026-05-03 decision has touched
that interface to add one (`git log` on `src/core/types/data-items.ts` shows edits through
2026-08-01, none adding a `last_discussed`-shaped field). This remains an open, un-actioned
suggestion, not a shipped follow-up.

## Alternatives Considered

### Alternative A: Remove Exposure now
- **Description**: Excise `exposure_current`/`exposure_desired` from `Topic`, `PersonaTopic`, and
  `Person`; delete `decay.ts`/`exposure.ts`; strip the ceremony decay phases and the heartbeat/
  context gap filters; drop `exposure_impact`/`exposure_desired` from every extraction/matching/
  persona-generation prompt.
- **Why rejected**: The surgery touches type definitions, six-plus default sites, two ceremony
  phases, two gap-filter call sites, and every prompt that currently asks an LLM to assess exposure
  impact — with no isolated seam to cut along. The payoff is parity with current behavior at best,
  since the RAG tools address relevance-on-demand, not historical engagement tracking; nothing a
  user would notice improves. A week of work for zero observable benefit was judged not worth doing
  now.

### Alternative B: Keep Exposure as the primary topic-surfacing driver, tune the defects instead
- **Description**: Fix the MAX-semantics clamp, rescale `exposure_desired` defaults per-topic-count,
  and re-derive the ceiling behavior, rather than treating Exposure as redundant.
- **Why rejected**: This treats the three defects as implementation bugs in an otherwise-correct
  design, but the underlying premise — that a scalar current/desired gap can substitute for a
  persona actually retrieving relevant memory on demand — is what the RAG tools superseded. Tuning
  the sledgehammer/ceiling/default problems would still leave a coarser, harder-to-reason-about
  mechanism duplicating what `find_memory`/`fetch_memory`/`fetch_message` now do more precisely.

### Alternative C: Rebuild `PersonaTopic` selection on `last_discussed` immediately
- **Description**: Ship the lightweight timestamp addition now, alongside the atrophy decision,
  rather than flagging it as a future candidate.
- **Why rejected**: Scoped as a follow-up, not bundled into this decision — the decision here is
  about the fate of the *existing* mechanism, and adding a new field is separable work that can
  happen (or not) independently of whether Exposure itself is kept, tuned, or removed.

## Consequences

### Positive

- No multi-file removal surgery was undertaken for a system whose removal would not have been
  user-visible — engineering time was spent elsewhere.
- The decision is explicit and discoverable rather than implicit: a future reader hitting the
  sledgehammer/ceiling/default behaviors will find this record instead of concluding the mechanism
  is an unnoticed bug or a still-load-bearing design.
- The RAG tools (`find_memory`/`fetch_memory`/`fetch_message` + the quote-chain) were validated as
  sufficient for the "what's relevant to discuss now" problem Exposure used to own, without having
  to simultaneously prove that by ripping out the older mechanism first.

### Negative

- The exposure→topic-surfacing code path keeps running every ceremony cycle
  (`ceremony.ts:299-341,385-430`) and on every heartbeat/response build
  (`heartbeat-manager.ts:145-150,167-172`, `prompt-context-builder.ts:156,198,302`), doing real work — LLM
  prompts still ask for `exposure_impact`/`exposure_desired`, decay still recomputes on every topic
  and person on every ceremony pass — that produces output nothing downstream meaningfully depends
  on being correct. This is a standing (small, per-ceremony) computation cost with no corresponding
  benefit.
- The ceiling problem is still live and unfixed: today, a topic the user discusses daily is still
  told by the gap math to be "change subject" (`exposure_desired - exposure_current` deeply
  negative once `current` saturates near `0.9`). Anything that still reads that gap as a genuine
  engagement signal — rather than as inert legacy scoring — will draw the wrong conclusion.
- The `last_discussed` addition flagged as worth considering has not been picked up in the three
  months since the original decision. It remains a real, if minor, gap in Persona Topic heartbeat
  sorting: today's only signal is `last_updated`, which is overwritten by decay on every ceremony
  pass (`ceremony.ts:328-332`) and therefore does not track "when was this topic last actually
  discussed" the way a dedicated timestamp would.

### Risks

- **Silent bit-rot risk.** Because nothing currently depends on Exposure being correct, a future
  refactor could break the decay math, the MAX clamp, or the gap filters without any test or user
  symptom surfacing it — the system can degrade further with no signal that it has. Nothing in this
  decision changes that; it is an accepted cost of "atrophy naturally" rather than "actively
  monitored and then removed."
- **The "atrophy naturally" plan has no trigger.** The decision says removal happens "as the RAG
  proves itself in practice," but records no concrete signal (a metric, a time box, a specific
  milestone) for when that has happened. Without one, this can remain dormant indefinitely rather
  than actually getting removed once the RAG has, in fact, proven itself.
- **A downstream ADR (ADR-004) already depends on this one being read first.** ADR-004 covers only
  the decay curve's *shape* and explicitly warns that tuning K is "unlikely to be the right lever
  for a topic-selection problem" because of this decision. Anyone who reads ADR-004 alone, without
  this one, could still reasonably conclude Exposure is load-bearing and worth tuning; this record
  is what closes that gap.

## Reversibility

**Moderate, and asymmetric.** Reverting to "Exposure is the primary driver" would mean re-trusting a
mechanism with three known, unfixed defects — cheap to do (nothing was removed), but reintroduces
behavior already judged unreliable. Proceeding to full removal (the deferred option this decision
declines to take now) is the harder direction: it requires touching every site enumerated in
Alternative A, and doing so safely means confirming nothing user-visible regresses once the RAG
path is the sole surfacing mechanism — exactly the surgery this decision defers. The lightweight
`last_discussed` addition, if picked up later, is cheap and fully additive regardless of which
direction Exposure itself eventually goes.

## References

- `src/core/utils/exposure.ts:3-13` — `calculateExposureCurrent`, the MAX-semantics clamp behind
  the sledgehammer and ceiling problems
- `src/core/utils/decay.ts:1-22` — the exponential decay formula Exposure values follow (curve
  shape itself is ADR-004's subject, not this one's)
- `src/core/orchestrators/ceremony.ts:299-341,385-430` — `applyDecayPhase` and `runHumanCeremony`,
  where decay is applied every ceremony cycle to Persona Topics, Human Topics, and People
- `src/core/heartbeat-manager.ts:106,145-150,167-172` — the engagement-gap filter and sort driving
  heartbeat topic/person surfacing from `exposure_desired - exposure_current`
- `src/core/prompt-context-builder.ts:156,198,302` — the same gap-driven `interested_topics`
  filter feeding response context
- `src/cli/corrections-endpoints.ts:104-105,123-124`, `src/core/handlers/dedup.ts:255`,
  `src/core/handlers/heartbeat.ts:164`, `src/core/handlers/human-matching.ts:151,327`,
  `src/core/handlers/persona-generation.ts:76,93` — every site defaulting `exposure_desired` to
  `0.5`, evidencing the default/scale problem
- `src/core/types/data-items.ts:14,32-37,47-57,65-75` — `DataItemBase.last_mentioned`, `Topic`,
  `PersonaTopic` (no `last_discussed` field today), and `Person`
- `src/core/tools/index.ts:31,54,73`, `src/core/tools/builtin/find-memory.ts:28`,
  `src/core/tools/builtin/fetch-memory.ts:24-44,48`, `src/core/tools/builtin/fetch-message.ts:54` —
  the `find_memory`/`fetch_memory`/`fetch_message` tools that made Exposure redundant as a driver
- `src/cli/retrieval.ts:134-135,213-214` — `LinkedItem`/`resolveLinkedItems`, the quote→topic/
  person/fact chain the RAG tools navigate
- ADR-004 — the narrower decay-curve-shape decision that sits downstream of this one. Its Risks
  section reproduced this decision's substance verbatim while this migration was pending, and
  explicitly named itself as not depending on the migration happening; this ADR is that migration,
  and is the fuller architectural-fate record ADR-004 points back to. ADR-004's account of the
  curve, and its own `K=0.1` provenance gap, are unaffected by this record.
