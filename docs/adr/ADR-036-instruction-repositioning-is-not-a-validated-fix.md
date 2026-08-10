# ADR-036: Instruction Repositioning Is Not a Validated Fix for Extraction Prompt Data-Handling Defects — Real Failure Cases Come First

## Status

Accepted

## Date

2026-08-10

## Context

Flare's working hypothesis, from direct prior production experience: every extraction prompt builder
uses Markdown headers (`#`/`##`) to delimit structural sections (`## Earlier Conversation`,
`## Most Recent Messages`), while every real message he sends is itself heavily Markdown-formatted.
The hypothesis was that this creates a structural-ambiguity collision, and that XML tags — which
essentially never occur in ordinary prose — would fix it.

A discriminating eval was built for `buildTopicUpdatePrompt` (`src/prompts/human/topic-update.ts`)
against two models: `google/gemma-4-26b-a4b-qat` (local, via LM Studio) and `claude-haiku-4-5`
(Anthropic — the model actually used for code-import extraction). A first fixture design produced a
near-100%-failure result on both models, control included — which turned out to be a fixture defect,
not a finding: it planted a fact in "Earlier Conversation" that was never reflected in the existing
topic record, manufacturing a gap that does not exist in production's real steady state (confirmed by
sampling real `~/.local/share/ei/logs/handleTopicUpdate*.json` calls). A corrected fixture — where the
existing record already states the "already processed" fact, and only a genuinely new incidental
detail is forbidden — produced the real result this ADR is based on.

### Finding 1 (confirmed defect): `topic-update.ts` leaks topically-relevant, heavily-formatted Earlier Conversation content

Four variants of the corrected fixture — plain prose, a literal `## Earlier Conversation` string
planted inside a message, generic heading noise, and heavy non-heading Markdown (bullets, a table, a
blockquote, bold) — were run at `repeat: 8` against both models. Clean, reproducible result across
independent reruns:

| Case | Gemma | Haiku |
|---|---|---|
| control (plain prose) | 62.5–100% pass | 0–12.5% pass |
| literal-heading-overlap | 62.5–100% pass | 0% pass |
| heading-level-noise | 87.5–100% pass | 12.5–62.5% pass |
| **markdown-volume** (bullets/table/blockquote/bold) | **12.5–25% pass** | **0% pass** |

`markdown-volume` is the one case that stayed low across every rerun for both models, while the other
three bounced within noise at `repeat: 8`. A follow-up probe kept the exact same heavy-Markdown
formatting but swapped the incidental detail for something equally specific and quotable but
genuinely off-topic (radio-station chatter instead of a budget-relevant supply-chain delay):

| Case | Gemma | Haiku |
|---|---|---|
| markdown-volume (on-topic detail) | 12.5–25% pass | 0% pass |
| markdown-volume (off-topic detail, identical formatting) | 87.5% pass | 100% pass |

Identical formatting, opposite result. **Format alone does not cause the leak.** The mechanism is an
instruction-priority conflict: `topic-update.ts`'s system prompt spends most of its length rewarding
accurate, current, topically-relevant synthesis ("capture what is true NOW", "detail...meaningful...
in six months or more", `src/prompts/human/topic-update.ts:108,214`). The instruction that says to
ignore genuinely relevant Earlier Conversation content is one unemphasized sentence, positioned in
`# CRITICAL INSTRUCTIONS` near the end of the system prompt, with no stated reason
(`src/prompts/human/topic-update.ts:279`): *"ONLY ANALYZE the 'Most Recent Messages'. The 'Earlier
Conversation' is provided for context only — it has already been processed."* When Earlier
Conversation content is genuinely relevant to the topic's current state, the dominant, repeated
synthesis instructions win over that one buried sentence — independent of delimiter type and largely
independent of surrounding format; heavy Markdown formatting modulates the failure rate (makes an
already-relevant fact read as a more explicit, extractable "field" — a `- New wrinkle:` bullet, a
table row) but is not itself the trigger.

**Two fixes were tried against this confirmed defect. Neither worked:**

1. **XML boundary tags.** `## Earlier Conversation` / `## Most Recent Messages` were swapped for
   `<earlier_conversation>` / `<most_recent_messages>` on the same fixtures, leaving message content
   and every other system-prompt header untouched. Result: no case improved for either model.
   Gemma's `markdown-volume` case got measurably worse (12.5% → 0%), and its `heading-level-noise`
   case regressed from a clean pass to 75-87.5%.
2. **A reasoned, repositioned scope instruction.** The same bare sentence was removed from its
   original position (after the JSON template, near the end of the system prompt) and replaced with a
   reasoned version — *"Only extract NEW information from the 'Most Recent Messages' section
   below... re-deriving facts [from Earlier Conversation] risks stale duplication or drift"* —
   inserted at the very start of the system prompt, right after `# Task`. This tests the "primacy
   beats recency for fine-tuned models" finding from an earlier session (topic "Primacy and recency
   effect in LLM processing") against Flare's own placement choice, made for the opposite reason
   (recency). Result, on a clean rerun after fixing a real harness bug (see Risks): `markdown-volume`
   held flat for both models — 12.5% for Gemma, 0% for Haiku, identical to the unmodified baseline.
   Every other case bounced within the same noise band already observed at `repeat: 8`, with no
   directionally consistent movement either way.

Two structurally different interventions, on the one confirmed, reproducible failure: zero reliable
improvement, one measurable regression.

### Finding 2 (rejected proposed fix, no confirmed defect): `person-update.ts`'s record-first ordering is intentional and correct

Flare's initial framing was that `person-update.ts` and `topic-update.ts` share the same prompt shape
and that `person-update.ts` — where "cross-pollination" between different people's records is most
often observed in practice — was the more consequential place to have run this investigation.
Checking `src/prompts/human/person-update.ts` directly surfaced a real structural difference, but not
the one first assumed:

- The conversation-boundary instruction ("ONLY ANALYZE the Most Recent Messages...",
  `person-update.ts:308`) is positioned identically to `topic-update.ts`'s — system, before the
  conversation data in `user`. No asymmetry here.
- The record-governing instruction — *"Apply changes to the record above **ONLY IF**... [detail
  should] **NOT** already be present in the record above"* (`person-update.ts:100,104`) — is
  positioned **after** the existing record, which `person-update.ts` deliberately shows **first**:
  *"Local models lose context from long prompts — this must be first"* (`person-update.ts:63-65`).
  `topic-update.ts` does the reverse: its equivalent rule ("NOT already be present in the description
  or name of the TOPIC", `topic-update.ts:215`) is stated first, and the existing record
  (`# Current Details of TOPIC`) is shown last (`topic-update.ts:293`).

This is the real, confirmed asymmetry — about the *existing-record* instruction, not the
conversation-boundary one Flare and Sisyphus were both initially picturing as "the same shape." A
smaller-scale eval tested it directly on the regular (non-Ei-persona) branch: an existing person
record with a heavily-Markdown-formatted description containing a specific fact, and a new message
that restates that same fact in passing while introducing one genuinely new fact. Two arms — the
current, as-shipped ordering, and the record-governing rule moved to precede the record (with "the
record above" corrected to "the record below" in the moved text, since a naive move would otherwise
leave a self-contradicting instruction) — each `repeat: 6`, judged by an `llm-judge` rubric for
whether the new fact was captured without needlessly re-deriving the already-known one:

| Case | Gemma | Haiku |
|---|---|---|
| current (record-first, rule-after — as shipped) | 100% pass (6/6) | 100% pass (6/6) |
| rule-before-record (moved) | **66.7% pass (4/6)** | 100% pass (6/6) |

The current, shipped ordering tested clean on both models. The proposed "move it earlier" fix — the
same class of change tried on `topic-update.ts` — **regressed** Gemma: twice, it restated the entire
existing record as a bulleted list instead of a lean update, something it never did under the current
ordering. Haiku showed no discriminating signal in either arm; this scenario simply doesn't exercise a
failure mode for it either way, which is a gap in the test, not evidence Haiku is immune.

**No live defect was found in current `person-update.ts` code by this investigation.** What was found
is that a specific proposed change to it is worse than what's already shipped, and that the shipped
design's own documented rationale (anchor on the record first, because local models lose context
across long prompts) holds up under direct test.

**The actual "cross-pollination" concern that motivated testing `person-update.ts` in the first
place — misattributing one person's details to a different person's record — was never tested this
session.** That's governed by separate instructions (`identityGuard`, `attributionGuard`,
`person-update.ts:172-176`) which are already positioned before the conversation data, and which
this investigation did not probe at all. The eval above tests record self-duplication within one
person's own update, a related but distinct failure class.

### A process finding, as real as the technical ones

Writing this ADR surfaced a third finding, about the investigation itself rather than the code: even
while explicitly trying to reconcile Sisyphus's audit with Flare's mental model of "the same problem
in a different prompt," both were still describing two different test cases — the conversation-
boundary asymmetry (which doesn't exist between these two builders) and the record-governing-
instruction asymmetry (which does) — under one shared, too-general label ("the instruction isn't
ahead-of-time"). **The problem case needs to be specific.** A failure mode stated at the level of "an
instruction comes after some data" is not specific enough to know which of two structurally different
situations in the same file it refers to, and the confusion survived a full round of direct source
verification before it was caught. This is a durable lesson for how this class of prompt-defect
investigation should be scoped going forward, independent of what happens with either finding above.

## Decision

**Do not pursue further blanket prompt-instruction repositioning or rewording as a fix strategy for
either builder, on the evidence gathered so far.** Two structurally different interventions were
tried against `topic-update.ts`'s one confirmed defect (XML boundary tags; a reasoned, repositioned
scope instruction) and one against `person-update.ts`'s proposed change (rule-before-record). None
produced a reliable improvement; one made a confirmed defect measurably worse, and one made an
already-clean case measurably worse. The evidence supports "the three specific things we tried don't
work" cleanly. It does not support "no prompt-text intervention could ever work" — untried directions
(strong-imperative-only phrasing without repositioning, few-shot examples, chain-of-thought
scaffolding) remain genuinely untested, and this decision should not be read as closing that door.

**Before any further prompt change to either builder: gather real, observed cases.** Every fixture in
this investigation was synthetic and deliberately worst-case — hand-built to probe a hypothesis, not
drawn from an actual failure anyone has seen in production. Zero real-world occurrences of either
finding above have been confirmed. Two separate case-gathering efforts are needed, not one, because
they are different failure classes: real `topic-update.ts` calls where Earlier Conversation content
is genuinely relevant to the topic under update and heavily Markdown-formatted; and real
`person-update.ts` cases matching the *actual* cross-pollination concern (misattribution between
different people's records), which this investigation never tested.

**Once real cases exist, the recommended lever is pre-processing the message content itself, not
re-arguing with the model via instruction text.** The confirmed mechanism for `topic-update.ts` is
content-driven (relevance + presentation), not location-driven — the model never failed to find the
boundary; it chose to cross a boundary it could see fine. That points at changing what the model sees
before it's asked to respect a boundary, rather than changing how the boundary is announced:

- **Filter** — do not include Earlier Conversation content matching known-risky shapes at all.
- **Reformat** — strip or flatten the specific Markdown structures (bullets, tables) that measurably
  amplified the failure, before the content reaches the prompt.
- **Pre-summarize** — condense Earlier Conversation / existing-record content into a terser form
  upstream, reducing both token weight and the "field-like" presentation that primes extraction.
- **Omit** — extend the existing `analyze_from_timestamp` downstream validator
  (`src/core/orchestrators/human-extraction.ts`) further upstream: reject or exclude at the pipeline
  level rather than trusting selective instruction-following at generation time.

None of these were attempted. They require the real cases above to know which shapes are actually
worth filtering, reformatting, summarizing, or omitting — building any of them now, against synthetic
worst-case fixtures, would repeat the same mistake the first (invalid) topic-update fixture made.

## Alternatives Considered

### Alternative A: Ship XML boundary tags for `topic-update.ts` (the original hypothesis)
- **Description**: Replace `## Earlier Conversation` / `## Most Recent Messages` with
  `<earlier_conversation>` / `<most_recent_messages>`, per Flare's original hypothesis and Anthropic's
  own prompt-engineering guidance recommending XML tags because they rarely occur in ordinary prose.
- **Why rejected**: Tested directly against the confirmed defect. No case improved; two cases
  (`markdown-volume`, `heading-level-noise` for Gemma) got measurably worse. The literal
  header-collision mechanism the hypothesis named — the two cases built to test it directly
  (`literal-heading-overlap`, `heading-level-noise`) — passed cleanly under plain Markdown, ruling
  out the mechanism itself, not just this specific fix.

### Alternative B: Ship the reasoned, repositioned scope instruction for `topic-update.ts`
- **Description**: Give the scoping instruction a stated reason and move it to primacy position
  (right after `# Task`), instead of an unexplained sentence buried after the JSON template.
- **Why rejected**: On a clean rerun (after fixing a harness bug that had been silently re-executing
  and overwriting the baseline's own results — see Risks), `markdown-volume` held flat at 12.5%
  (Gemma) and 0% (Haiku), identical to the unmodified baseline. A single noisy pre-bugfix sample had
  shown 25% for Gemma and was reported as a "modest improvement" before the clean rerun retracted it.
  No reliable effect either direction on the case that matters.

### Alternative C: Ship the rule-before-record change for `person-update.ts`
- **Description**: Move the "don't duplicate what's already in the record" instruction to precede the
  `Current record` JSON, matching `topic-update.ts`'s ordering, on the theory that the two builders
  should share one consistent shape.
- **Why rejected**: Tested directly. Regressed Gemma from 100% clean to 66.7%, with the model twice
  restating the entire existing record as a bulleted list instead of doing a lean update — something
  it never did under the current, shipped ordering. Validates the code's own documented
  context-anchoring rationale rather than refuting it.

### Alternative D (chosen): Defer all three; gather real cases; then choose a data-side lever
- **Description**: Treat both findings as documented and closed for now, without a shipped code
  change. Prioritize collecting real occurrences of each distinct failure class over further
  synthetic-fixture experimentation. Once real cases exist, choose among filtering, reformatting,
  pre-summarizing, or omitting message content upstream of the prompt.
- **Why chosen**: The alternative — continuing to iterate on prompt wording/position without real
  cases to validate against — is exactly the pattern that produced an invalid fixture and a false
  "ignored near-universally" finding earlier in this same investigation, caught only because
  production experience contradicted it. Pre-processing decisions (what to filter, how much to
  summarize, which shapes to omit) need real examples to be anything more than another guess with the
  same failure mode.

## Consequences

### Positive

- Two specific, plausible-looking fixes were tested and rejected on real evidence before either
  shipped — `topic-update.ts`'s markdown-volume leak would still be unfixed under XML tags (and
  slightly worse in places), and `person-update.ts`'s current design would have been actively
  regressed by the "consistency with topic-update" instinct.
- `topic-update.ts`'s confirmed defect now has permanent, non-gating regression/monitoring coverage:
  `tests/evals/topic-update.eval.ts`'s two added cases (tagged `known-model-limitation:heavy-markdown`,
  `pass_threshold: 0`, and `regression-guard` respectively) track the exact mechanism found here
  without blocking the build on a documented, accepted limitation.
- `person-update.ts`'s current ordering now has permanent regression coverage of its own
  (`tests/evals/person-update-record-scope.eval.ts`) — a future accidental reordering toward
  `topic-update.ts`'s shape would be caught rather than silently regressing Gemma the way the tested
  alternative did.
- The process finding (a failure mode needs to be specific to the actual data/instruction pair, not
  just "instruction after data" in the abstract) is now written down rather than re-discovered the
  next time this class of investigation runs.

### Negative

- `topic-update.ts`'s confirmed leak ships unfixed. It fires specifically when Earlier Conversation
  content is genuinely relevant to the topic under update and heavily Markdown-formatted (bullets,
  tables, blockquotes) — narrower than "any Markdown," per Flare's own framing that the tested
  scenario is a worst case well beyond typical usage, but real whenever that narrower condition is
  met.
- No real-case-gathering effort has started. This decision names it as the required next step but
  does not schedule or scope it.
- `person-update.ts`'s actual cross-pollination concern — the one that originally motivated testing
  this builder — remains completely untested. This ADR resolves a different, adjacent question
  (record self-duplication) and should not be read as having addressed cross-pollination at all.
- Five other builders share `topic-update.ts`'s same context/analyze split
  (`topic-scan`, `person-scan`, `person-update`, `event-scan`, `fact-find`, plus
  `persona/topics-rate.ts` and both `heartbeat/` builders) and have never been tested for the same
  markdown-volume-driven leak. Nothing here confirms or rules out the same defect existing there.

### Risks

- **No trigger for the real-case-gathering work named in the Decision.** Same shape as the risk
  ADR-025 named for its own "atrophy naturally" plan: a decision that defers action pending a
  future condition, with no concrete signal, time box, or owner for when that condition is met, can
  remain deferred indefinitely rather than actually getting picked up.
- **The narrow, confirmed `topic-update.ts` defect could be mistaken for "fully investigated and
  therefore safe to ignore."** It is documented and monitored, not fixed; the monitoring case
  (`pass_threshold: 0`) will report a real, nonzero failure rate on every eval run and should not be
  read as passing in the normal sense.
- **A real bug in the eval harness was found and fixed mid-investigation**: three sibling eval files
  imported shared fixtures directly from a file with an unguarded top-level `await runEval(...)`,
  causing an ES-module side effect that silently re-ran and overwrote the baseline's own result file
  every time a sibling arm ran. This is why one reported number (a "modest improvement" on
  `markdown-volume` under the reasoned-scope arm) had to be retracted after a clean rerun. The fix
  (moving shared fixtures into a side-effect-free constants module,
  `tests/evals/topic-update-delimiter-ambiguity.fixtures.ts` at the time, since removed along with the
  experiment files it served) generalizes: any future eval file that imports constants from another
  runnable `*.eval.ts` file risks the same silent contamination.

## Reversibility

**Cheap in both directions.** Nothing was shipped to either prompt — `topic-update.ts` and
`person-update.ts` are both unchanged from before this investigation. The two permanent eval cases
added to `tests/evals/topic-update.eval.ts` and the new `tests/evals/person-update-record-scope.eval.ts`
are pure additions with no gating behavior change; removing them later costs nothing. If real cases
are gathered and point toward a pre-processing fix, that work starts from a clean baseline with no
rejected-alternative code to unwind first.

## References

- `src/prompts/human/topic-update.ts:108,214,215,279,293,299-308` — the synthesis-quality
  instructions, the record-duplication guard (stated first, before the record), the buried scoping
  instruction, and the record/conversation sections it fails to consistently govern
- `src/prompts/human/person-update.ts:63-65,77,86,90,100,104,306-308,325-334` — the record-first
  anchoring rationale, the record-governing rule positioned after it, and the (unchanged, correctly
  primacy-positioned) conversation-boundary instruction
- `tests/evals/topic-update.eval.ts:311-337` — the permanent, non-gating monitoring case for the
  confirmed `markdown-volume` leak (`known-model-limitation:heavy-markdown`, `pass_threshold: 0`)
- `tests/evals/topic-update.eval.ts:338-359` — the permanent regression guard confirming
  topically-irrelevant content stays excluded under identical formatting
- `tests/evals/person-update-record-scope.eval.ts` — the full current-vs-rule-before-record
  comparison for `person-update.ts`, including the `toRuleBeforeRecord` transform and its
  "record above" → "record below" wording correction
- `src/core/orchestrators/human-extraction.ts` — `analyze_from_timestamp`, the existing downstream
  validator whose reject-rather-than-trust philosophy the Decision section proposes extending
  upstream, as one candidate among the untried pre-processing levers
