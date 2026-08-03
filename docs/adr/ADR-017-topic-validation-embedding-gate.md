# ADR-017: Topic Validation Uses a Top-1 Embedding Gate, Not Ceremony-Wide Clustering

## Status

Accepted

## Date

2026-08-03

## Context

The extraction pipeline's Topic path runs Scan → Match → Update. Match compares a newly
scanned candidate against existing topics using a wide, low-precision net —
`findTopK` at `topK=20`, filtered at `EMBEDDING_MIN_SIMILARITY = 0.3`
(`src/core/orchestrators/human-extraction.ts:320-321`) — because at Match time the candidate
has only the sparse description Scan produced. When Match misses, Update creates a brand-new
topic with a rich, LLM-synthesized description and a fresh embedding computed from that richer
text. That richer description and embedding would very plausibly have matched an existing topic
— but Match already ran, and already decided "no match," before either existed. The result was
observed directly during a re-extraction ceremony: a Gemma re-run over three months of history
produced duplicate `Sisyphus` and `Wife`/`Spouse`/`Lis` records, because sparse-description Match
missed what a synthesized-description comparison would have caught.

**This was not the first attempt at solving topic duplication, and the earlier attempt is part of
this decision's history, not just background.** From 2026-03-11 to 2026-04-06, Ei ran a
ceremony-wide deduplication phase (`queueDedupPhase`, `src/core/orchestrators/dedup-phase.ts`,
introduced in commit `8c66370f`). It worked by O(n²) pairwise cosine comparison across *every*
embedded, non-Persona `DataItemBase` in state — Topics and People together, with no per-pair LLM
context beyond "here's a cluster of items above a single global threshold" — then handed whole
clusters to an LLM curator to merge. That global threshold could not be made to fit the corpus:
it started at 0.95, was lowered to 0.85 two days later because analysis showed 0.95 caught only
3.9% of duplicate name groups against 0.85's 46.7% (commit `e3191fa2`), and was raised back to
0.95 four days after that because on Ei's single dense-domain topic corpus, 0.85 produced
mega-clusters that persisted "all the way to 0.92" — only at 0.95 did the largest cluster drop to
7 items (commit `6a925004`). A single global similarity cutoff, applied to a heterogeneous corpus
via unsupervised pairwise clustering, oscillated for a week and never stabilized.

Ceremony-wide dedup was deliberately retired in commit `6540e253` ("feat: retire topic auto-dedup
from ceremony; remove queuePersonMatch", shipped in `v0.6.0`), deleting 199 lines of clustering
logic from `dedup-phase.ts`. The stated goal was narrower than what it did: People no longer
needed embedding-cluster dedup because person matching had just moved, the same day, to
synchronous identifier-value lookup plus Levenshtein fuzzy name matching (commit `ab8d9722`,
carried forward today in `queuePersonUpdate`, `src/core/orchestrators/human-extraction.ts:596`) —
a mechanism that exploits identifiers Topics don't have and doesn't need embeddings at all.
Removing `queueDedupPhase` to retire *that* also removed Ei's only automatic duplicate defense for
Topics, as an acknowledged side effect, not a separate decision. For three days, new topics had no
automatic dedup safety net of any kind.

Cosine similarity alone, independent of the clustering-vs-pairwise question, is also not a
reliable duplicate signal on its own: "I hate snow" and "I hate rain" sit close in embedding
space without being the same fact. Any embedding-only approach — clustered or pairwise — needs an
LLM in the loop to convert "close in vector space" into "actually the same thing."

## Decision

**Add a fourth pipeline step, Validate, that runs only immediately after a *new* Topic is
created, compares it to the single best-matching existing Topic (not a cluster), and asks the LLM
a strictly binary merge-or-keep-both question — using a dedicated prompt, not the ceremony-wide
curator prompt. This never applies to People.**

Concretely, as implemented:

1. **Trigger: post-create, Topic-only.** `handleTopicUpdate` calls `queueTopicValidate` only when
   `isNewItem && embedding` (`src/core/handlers/human-matching.ts:170-173`) — after the topic has
   already been upserted into state with its synthesized description and computed embedding.
   There is no equivalent call for People anywhere in the codebase; `queuePersonUpdate`'s
   duplicate defense is the identifier/fuzzy-name matching described above, run *before* the LLM
   call rather than checked against an embedding afterward.

2. **Top-1, not top-K.** `queueTopicValidate` (`src/core/orchestrators/human-extraction.ts:783-833`)
   filters existing topics to those with embeddings, excludes the new topic itself, and calls
   `findTopK(newTopic.embedding, candidates, 1)` (`src/core/embedding-service.ts:28`) — exactly one
   candidate, the closest. If that single best match falls under `VALIDATE_MIN_SIMILARITY` (or no
   candidates exist), the topic is accepted as genuinely new with no LLM call at all
   (`human-extraction.ts:801-806`).

3. **Threshold: `VALIDATE_MIN_SIMILARITY = 0.92`** (`src/core/orchestrators/human-extraction.ts:328`),
   deliberately higher than Match's `EMBEDDING_MIN_SIMILARITY = 0.3` — Match needs a wide recall
   net over sparse text; Validate needs to fire only on genuine near-duplicates of a rich,
   synthesized description. See History below for why this is 0.92 today and not the 0.85 first
   shipped.

4. **A dedicated binary prompt, not the ceremony curator's.** When the threshold is met,
   `queueTopicValidate` calls `buildValidatePrompt` (`src/prompts/ceremony/dedup.ts:147-232`), built
   specifically for a two-record, binary decision — "merge" or "keep both," nothing else. This is a
   different function from `buildDedupPrompt` (`dedup.ts:15`), the ceremony-wide curator prompt
   built for N-way clusters; `buildDedupPrompt` has zero callers in current source — it was written
   for the retired `queueDedupPhase` and never wired to anything else. The prompt is explicit about
   the asymmetry of the two possible mistakes: *"Default to keeping both. Merge only when you are
   certain these describe the same concept — thematic overlap, shared vocabulary, or similar domain
   are not sufficient. A false merge destroys information permanently; a false keep is harmless."*
   (`dedup.ts:168`).

5. **Shared execution, distinct entry points.** The queued request uses
   `next_step: LLMNextStep.HandleTopicValidate` (`human-extraction.ts:826`), a distinct enum value
   from `LLMNextStep.HandleDedupCurate` (the manual/user-triggered path, still reachable via
   `queueUserDedupRequest`, `src/core/orchestrators/dedup-phase.ts:11-50` — unchanged since it
   survived the 2026-04-06 retirement). Both route to the same handler,
   `handleDedupCurate` (`src/core/handlers/dedup.ts:18`) — registered twice in the handler map
   (`src/core/handlers/index.ts:39,44`) — so Validate's merge/remove/add application reuses the
   exact machinery already hardened for manual dedup: Quote foreign keys are repointed before any
   entity is deleted, and `persona_groups`/`interested_personas` are unioned across a merge
   (`dedup.ts:15-16,49-51,103-128`), rather than a new, separately-tested merge path.

## History

The plan that seeded this work initially proposed `VALIDATE_MIN_SIMILARITY = 0.85` — a guess,
explicitly labeled as one, pending tuning. Git history shows the constant did in fact ship at
0.85, then moved:

- **`7e14e8d5`** (2026-04-09) — "feat: add topic validate phase — post-create near-duplicate
  detection and merge." Introduces `queueTopicValidate`, `buildValidatePrompt`, and
  `export const VALIDATE_MIN_SIMILARITY = 0.85;`. Shipped three days after `6540e253` closed the
  Topic-dedup gap left by ceremony-wide retirement.
- **`a9c83da5`** (2026-04-09, same day) — unit tests for `queueTopicValidate` land alongside the
  feature.
- **`f0c57e41`** (2026-04-30) — "fix(core): raise dedup similarity threshold to 0.92; add
  conservative merge instruction." Commit message: *"all-MiniLM-L6-v2 has semantic inflation at
  0.85 (vocabulary overlap, not true duplicates). 0.92 is the dedup zone for this model."* The
  diff is a one-line constant change (`0.85` → `0.92`) plus the "Default to keeping both" prompt
  paragraph quoted above, plus a regression eval for the case that forced the change: two topics —
  an AWS/Expedia hackathon record and an Ei local-first-storage record — scored **0.892** cosine
  similarity on shared vocabulary ("architecture," "system," "data") despite being about
  completely unrelated subjects. That exact case is still in the eval suite today (see Test
  Coverage below) at `similarity: 0.892`, just under the new 0.92 gate. **The plan's 0.85 claim was
  accurate on 2026-04-09 and has been stale since 2026-04-30; current source is unambiguous
  at 0.92.**
- **`a6ed8c19`** (2026-05-02) — "feat(core): keep low-density topics that strongly match existing
  topics." A second, unrelated consumer of the same constant: Scan had a density filter that
  discarded low-signal candidates outright; this commit added `getBestTopicSimilarity`
  (`human-extraction.ts:336-356`) so a low-density candidate scoring ≥ `VALIDATE_MIN_SIMILARITY`
  against an existing topic would still be queued for Match, on the reasoning that "a density=2
  topic that cosines at 0.97 against an existing topic is an update to known knowledge, not
  noise."
- **`f9f81b0b`** (2026-05-03, the very next day) — "refactor(core): remove duration gate —
  downgrade to logging, pass all topics through." The density gate itself was found unreliable
  (`"duration scores are chunk-size-sensitive and drift ±1 across runs"`) and removed entirely,
  downgraded to a log line. This left `getBestTopicSimilarity` exported
  (`src/core/orchestrators/index.ts:15`) with **no current callers** — a residual dead-code path
  from a one-day-lived feature, not part of the Validate decision itself. It remains this way in
  current source.

**Was the old ceremony-wide clustering approach ever actually implemented, or only ever
speculative?** Implemented and shipped, for 26 days. Commit `8c66370f` (2026-03-11) added
`queueDedupPhase` as ceremony Phase 1: pairwise cosine clustering over every embedded, non-Persona
item — People and Topics together — feeding an LLM curator. Its threshold churned within that
window (`e3191fa2`: 0.95→0.85 for recall; `6a925004`: 0.85→0.95 four days later to stop
mega-clusters on Ei's dense single-domain corpus) before the whole phase was deleted in `6540e253`
(2026-04-06, `v0.6.0`) as a side effect of retiring ceremony-wide Person dedup. It was real,
running code with real production behavior and a documented failure mode (threshold sensitivity
to corpus density) — not an idea that was discussed and abandoned before being built. That
documented failure mode is also the reason Validate does not repeat it: pairwise top-1 comparison
against one fresh, richly-described record sidesteps the "single global threshold across a
heterogeneous, clustering corpus" problem that made the old approach's threshold unstable, and the
0.85→0.92 move for the *same underlying reason* (embedding-model vocabulary inflation, not corpus
heterogeneity this time) shows the lesson carried forward rather than being relearned from
scratch.

## Alternatives Considered

### Alternative A: Restore ceremony-wide clustering dedup (`queueDedupPhase`)
- **Description**: Re-add the deleted Phase 1 clustering logic instead of building a new
  post-create step.
- **Pros**: Already-written code; would have caught duplicates across both Topics and People in
  one batch pass.
- **Cons**: This is the exact mechanism the History section shows churning between 0.85 and 0.95
  within one week on the same corpus, without ever finding a threshold that worked well for both
  cluster containment and recall. Batch timing also means a duplicate topic sits in state,
  visible and usable, for however long until the next ceremony run — worse than closing the gap at
  creation time.
- **Why not chosen**: Explicitly out of scope in the originating design work, on the stated
  grounds that "cosine-only" clustering had already been proven unreliable; git history in this
  ADR independently confirms why.

### Alternative B: Widen or retune the Match step instead of adding Validate
- **Description**: Fix the root symptom (Match misses near-duplicates) by adjusting Match's own
  `topK`/`EMBEDDING_MIN_SIMILARITY`, rather than adding a step after Update.
- **Cons**: The root cause is not Match's threshold — it's that Match runs against a
  Scan-synthesized *sparse* candidate description, while the record that would actually match
  doesn't get its rich, comparison-worthy description and embedding until *after* Update creates
  it. No threshold change at Match time supplies information that doesn't exist yet at Match time.
- **Why not chosen**: Structurally can't address the timing gap; a post-Update check is the only
  point in the pipeline where the richer description exists to compare with.

### Alternative C: Apply Validate to People as well as Topics
- **Description**: Run the same top-1-embedding-then-binary-LLM gate for newly created Person
  records.
- **Cons**: People already get a pre-LLM duplicate defense that fires before Validate ever could —
  exact identifier-value lookup, then Levenshtein fuzzy name matching (`ab8d9722`,
  `queuePersonUpdate`) — built specifically to exploit identifiers (email, phone, nickname) that
  Topics don't have and that are considerably more reliable than post-hoc embedding comparison for
  distinguishing, say, two different people who happen to share a vague description.
- **Why not chosen**: The type signature already supports it cheaply if ever needed —
  `ValidatePromptData.itemType` and `buildValidatePrompt` are typed over `RewriteItemType = "trait"
  | "topic" | "person"` (`src/prompts/ceremony/types.ts:7,70-74`), so `buildValidatePrompt` already
  accepts `"person"` — but no orchestrator call site exists for it, and identifier matching solves
  the same problem more reliably for an entity type that has identifiers.

### Alternative D: Run Validate inline/synchronously instead of queuing it
- **Description**: Have `queueTopicValidate` await the LLM merge decision directly inside the
  extraction chain, rather than enqueuing `HandleTopicValidate` and letting the queue process it
  as a separate LLM request.
- **Cons**: Inline execution risks cascading edge cases if Validate's own merge/remove touches
  state that the rest of the in-flight extraction chain is still relying on.
- **Why not chosen**: The implementation enqueues via `state.queue_enqueue` with
  `next_step: LLMNextStep.HandleTopicValidate` (`human-extraction.ts:820-832`) exactly like every
  other extraction step — non-blocking, and consistent with how Match/Update/Scan are already
  structured, at the cost of a short window where the un-validated duplicate is visible before the
  queue drains.

## Consequences

### Positive

- Closes the specific gap this decision exists to close: the record actually compared for
  duplication is the post-Update, LLM-synthesized description and embedding — the same
  information that was missing at Match time — not the sparse Scan candidate that caused the miss
  in the first place.
- Reuses `handleDedupCurate`'s already-hardened merge machinery (Quote FK repointing before
  deletion, `persona_groups`/`interested_personas` union) instead of a new, separately-tested
  code path for automatic merges.
- The higher threshold plus "default to keeping both" makes the cheaper mistake (two records
  instead of one) far more likely than the expensive one (irreversible loss of unique
  information) — directly informed by a production false-merge risk caught by eval rather than in
  the wild.
- No ceremony-timing dependency: the check runs at topic-creation time on every extraction run,
  not only when a periodic ceremony phase happens to execute, closing the window where a duplicate
  could sit unaddressed that the old design had.

### Negative

- Validate only ever looks at the moment a Topic is created. It has no mechanism for retroactively
  deduping Topics that already coexist in state — from before this shipped, or from any gap in
  coverage — that responsibility still rests entirely on the manual `queueUserDedupRequest` path.
- People get no automatic post-create embedding check of any kind. A person whose identifiers
  don't line up textually (the same "Wife"/"Spouse"/"Lis" vocabulary-mismatch failure that
  motivated this work for Topics) can still produce a duplicate Person record that nothing catches
  automatically — Validate's design deliberately does not cover this case (Alternative C).
- `getBestTopicSimilarity` is exported dead code today: added for a different feature
  (`a6ed8c19`) built on top of `VALIDATE_MIN_SIMILARITY`, then orphaned the next day when that
  feature was removed (`f9f81b0b`) without removing the now-unused helper.

### Risks

- **The threshold is a single global constant tied to one embedding model's similarity
  distribution.** `f0c57e41`'s own rationale — "all-MiniLM-L6-v2 has semantic inflation at 0.85" —
  is model-specific. Nothing in the code re-validates 0.92 against a different embedding model if
  `getEmbeddingService()`'s backing model ever changes; the exact failure mode that forced
  0.85 → 0.92 could recur at a different value with no structural signal to catch it.
  `VALIDATE_MIN_SIMILARITY` last changed for this reason 95 days ago as of this writing.
- **A single-model threshold problem already happened twice, in two different implementations,
  independently converging near the same value.** The retired ceremony clustering's
  `DEDUP_DEFAULT_THRESHOLD` and Validate's `VALIDATE_MIN_SIMILARITY` are unrelated constants in
  unrelated code paths, tuned six weeks apart for different underlying reasons (corpus
  heterogeneity vs. embedding-model vocabulary inflation), and both landed in the 0.92-0.95 band.
  That is suggestive, not proof, that this corpus/model combination has a real "duplicate zone"
  near there — but nothing enforces it, and a future change to either the embedding model or the
  corpus's characteristic density could move it again without warning.
- **The binary LLM decision can still be wrong in the "should merge" direction** on a
  sufficiently convincing pair the eval suite doesn't cover; the Frankenstein-case eval
  (see below) exists because 89.2% cosine similarity produced a real false-merge risk once
  already, and a high-similarity, low-relatedness pair the current eval doesn't model is not
  structurally excluded from recurring.

## Reversibility

**Threshold**: Trivial. `VALIDATE_MIN_SIMILARITY` is a single exported constant
(`human-extraction.ts:328`) with no migration required to change.

**Scope to People**: Cheap relative to a from-scratch feature. `buildValidatePrompt` and
`ValidatePromptData` already type over `"person"` (`ceremony/types.ts:7,70-74`); the missing piece
is an orchestrator analog to `queueTopicValidate` and a call site inside `queuePersonUpdate`'s
post-create path — no prompt or handler rework needed.

**Restoring ceremony-wide clustering**: Moderate. The deleted 199 lines are recoverable from git
history at revisions before `6540e253`, but re-adding them reintroduces the exact threshold
instability documented in History, with no indication anything about the underlying clustering
approach would behave differently a second time.

**What cannot be recovered**: Topics silently merged by Validate before this ADR — if a false
merge already happened, the absorbed record's unique content, once folded into the survivor's
description and deleted, is not distinguishable after the fact from information the survivor
always had. This is the same category of risk the "default to keeping both" instruction exists to
minimize going forward, not to undo retroactively.

## Test Coverage

**Unit tests** (`tests/unit/core/orchestrators/human-extraction.test.ts`, `describe("queueTopicValidate", ...)`,
lines 482-599) lock in, against a mocked `findTopK` and mocked `buildValidatePrompt`:
- A best-match similarity at or above `VALIDATE_MIN_SIMILARITY` enqueues `HandleTopicValidate`
  with `entity_ids: [existingTopic.id, newTopic.id]` and forwards `buildValidatePrompt`'s exact
  `{ established, newcomer, itemType: "topic", similarity }` arguments.
- A best-match similarity one hundredth below threshold enqueues nothing.
- A new topic with no embedding short-circuits before `findTopK` is even called.
- A human with no other embedded topics enqueues nothing (no self-comparison).
- The new topic is excluded from its own candidate pool (verified by inspecting the array actually
  passed to `findTopK`).
- `extractionModel` is forwarded onto the queued request's `model` field.

**Evals** (`tests/evals/topic-validate.eval.ts`, run via `npm run test:evals`, live-LLM
regression checks against `buildValidatePrompt`'s actual output, not mocks) lock in judgment
quality across six scenarios:
- Two differently-worded records of the same concept ("Career development" / "Professional
  growth") should merge, with `remove` containing exactly one entry and `add` empty.
- A same-concept merge must synthesize details from *both* records (cross-country moves, values
  skill-stretching roles *and* consulting-vs-product reflection, learning motivation) under 500
  characters, and apply the numeric merge rules verbatim: higher-value wins for
  `exposure_current`/`exposure_desired`, `sentiment` averages.
- Two topics that share semantic space but opposite emotional valence ("Career anxiety" vs.
  "Career ambitions") must be kept separate.
- A newcomer overlapping a single facet of an already-bloated established topic ("Software side
  projects" vs. "Tempo project") should merge without letting the merged description exceed 500
  characters, and must never populate `add`.
- **The exact regression case that forced the 0.85 → 0.92 threshold change**: an AWS/Expedia
  hackathon record and an Ei local-storage-architecture record, scored at the real historical
  similarity of `0.892`, asserted to keep both — this is the eval added in `f0c57e41` and it is
  still the case guarding against re-introducing that specific false-merge failure mode.

Both suites currently exist, are populated with the cases described above, and were verified
against live source for this ADR — not inferred from the originating plan file.

## References

- `src/core/orchestrators/human-extraction.ts:320-356,783-833` — `EMBEDDING_MIN_SIMILARITY`,
  `VALIDATE_MIN_SIMILARITY`, `getBestTopicSimilarity` (dead code), `queueTopicValidate`
- `src/core/handlers/human-matching.ts:170-173` — the `isNewItem && embedding` gate that calls
  `queueTopicValidate` only for newly created topics
- `src/prompts/ceremony/dedup.ts:15,147-232` — `buildDedupPrompt` (unused today) vs.
  `buildValidatePrompt` (the binary merge-or-keep prompt this decision introduced), including the
  "default to keeping both" instruction at `:168`
- `src/core/handlers/dedup.ts:18` — `handleDedupCurate`, shared by both the automatic Validate path
  and the manual dedup path
- `src/core/handlers/index.ts:39,44` — both `LLMNextStep.HandleDedupCurate` and
  `LLMNextStep.HandleTopicValidate` route to `handleDedupCurate`
- `src/core/orchestrators/dedup-phase.ts` — `queueUserDedupRequest`, the surviving manual/
  user-triggered dedup path (uses `buildUserDedupPrompt`, not `buildDedupPrompt` or
  `buildValidatePrompt`)
- `src/core/orchestrators/human-extraction.ts:596` — `queuePersonUpdate`, the identifier-based
  mechanism that makes Person auto-dedup unnecessary via embeddings
- `src/prompts/ceremony/types.ts:7,63-74` — `RewriteItemType`, `DedupPromptData`,
  `ValidatePromptData`
- `src/core/embedding-service.ts:28` — `findTopK`
- `tests/unit/core/orchestrators/human-extraction.test.ts:482-599` — unit coverage
- `tests/evals/topic-validate.eval.ts` — live-LLM regression coverage, run via `npm run
  test:evals`
- Commits `8c66370f`, `e3191fa2`, `6a925004`, `4f959322`, `ab8d9722`, `6540e253`, `7e14e8d5`,
  `a9c83da5`, `f0c57e41`, `a6ed8c19`, `f9f81b0b` — the full evolution traced in History
