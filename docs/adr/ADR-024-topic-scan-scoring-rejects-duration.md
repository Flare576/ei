# ADR-024: Topic-Scan Scoring Rejects Density, Duration, and Importance — No Numeric Gate Ships

## Status

Accepted

## Date

2026-08-03 — backfilled. The decision itself was made 2026-05-02 through 2026-05-04 (see History)
and predates this directory's convention.

## Rationale Provenance

**STATED**, for the replacement mechanism. Current source shows exactly what carries the gating
weight today: the topic-scan prompt's plain-language instructions, quoted verbatim in Decision
below (`src/prompts/human/topic-scan.ts:43,45`), and a scan handler that queues every candidate
unconditionally with no numeric field checked (`src/core/handlers/human-extraction.ts:182-203`).
Nothing here is reconstructed — it is read directly from the file.

**STATED**, for the specific density → duration → importance sequence and why each was rejected.
This is not present as prose in current source (the fields themselves are gone), but the full
sequence is independently corroborated by an unbroken git commit trail on the exact files this ADR
cites, including a final commit whose message states the conclusion outright — see History. Per
this directory's convention ("if someone does dig blame for a given decision, record what they
found"), that trail was dug and is recorded below rather than left as a bare assertion.

**UNRECORDED**, for whether the `importance` evaluation's 15-case sample (Alternative C) is
reproducible today. The eval fixture that exercised it (`tests/evals/topic-scan-duration.eval.ts`)
was deleted in the same commit that removed the field; no artifact of the 15 cases or their scores
survives in current source.

## Context

During Ei's v1.0 `personaHistory` re-scan work, the topic-scan prompt was observed discarding
legitimate topics. The mechanism responsible was a numeric field, scored 1–5 by the LLM per
candidate topic, checked against a threshold in the scan handler before a topic was allowed
through to the Match/Update steps of the pipeline. Three successive versions of that field were
tried and rejected before the decision recorded here: ship no numeric gate at all.

**`density`** — "how central is this topic to the Most Recent Messages (1–5)?" This was
chunk-size-sensitive: in a large chunk containing many topics, even a short-but-meaningful exchange
scores low simply because it is a small fraction of the payload. One recorded case: a topic about a
card game tied to a deceased friend scored `density=2` in a ceremony run and was gated out; replay
at temperature 0.7 showed the score floating between 2 and 3 across runs — the gate was discarding
material based on LLM sampling variance, not signal quality.

**`duration`** — "how many exchanges did the human spend on this (1–5)?" The insight that killed it:
"I love you" is three tokens and could be the most important message in the system. Duration
measures engagement *length*, not importance — the two are not the same axis. An audit of 44
low-duration topics across 700 calls found roughly a third genuine noise, a third genuine signal,
and a third genuinely ambiguous: the *scoring* was internally consistent, but the *metric* was
answering the wrong question.

**`importance`** — "how much does this topic matter to the human (1–5), based on how they engaged?"
Evaluated (never shipped as a production gate) against 15 real cases: the 5 KEEP cases (emotionally
engaged exchanges) were identified perfectly — reading emotional engagement is exactly what LLMs are
good at. But the 1 SKIP case failed: a "contagion effect" inflated the score for a topic that
generally matters to the human but was only mentioned in passing this time — a passing frustration
about CSS bloat scored high because CSS bloat is a genuinely frustrating, generally-important topic
to this user, not because the mention itself carried weight. `importance` was measuring topic
*salience* ("does this matter in general?"), not engagement *depth* ("did they engage with it just
now?") — answering a different question than the one the gate needed answered, the same class of
mismatch that killed `duration`.

These findings came from `google/gemma-4-26b-a4b` and `claude-haiku-4-5` in May 2026, against one
dataset (one user's personal conversation history, roughly March–April 2026) at one chunk-size
regime (~30k tokens). Model behavior on scoring tasks shifts with versions; none of the three
rejections above should be read as a permanent verdict on the general approach, only on these
specific attempts under these specific conditions.

## History

Current source (`git log`) independently confirms the sequence above at the commit level, on the
exact files this ADR's Decision section cites:

| Date | Commit | Change |
|---|---|---|
| 2026-05-02 | `e3cf13fd` | `feat(prompts): add confidence to person-scan and density to topic-scan` — introduces both fields together |
| 2026-05-02 | `c7d4becf` | `feat(core): filter low-confidence people and low-density topics at scan` — ships the `density` gate |
| 2026-05-02 | `a6ed8c19` | `feat(core): keep low-density topics that strongly match existing topics` — adds `getBestTopicSimilarity` as a density-gate override |
| 2026-05-03 | `3bc5e289` | `refactor(prompts): rename density → duration with isolation-based scoring rubric` |
| 2026-05-03 | `f9f81b0b` | `refactor(core): remove duration gate — downgrade to logging, pass all topics through` — commit message: *"duration scores are chunk-size-sensitive and drift ±1 across runs, making the gate unreliable"* |
| 2026-05-03 | `7d13bc42` | `chore: remove all density references — density is dead, long live duration` |
| 2026-05-04 | `cbb99fd1` | `refactor(prompts): remove duration field — experiment complete, learn and move on` |

`cbb99fd1`'s full commit message states the conclusion directly: *"Density → duration → importance
was a productive experiment. Importance correctly identified emotional weight but caused false
positives on topic salience vs. engagement depth. The existing scan prompt ('meaningfully
discussed', 'conservative') already does the right job. No gate needed at current scale."* — and
names the source document this ADR migrates. Every commit in this trail is authored by `flare576`
with `Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>`, establishing the decision's
participants as Flare and Sisyphus, working across three days (2026-05-02 through 2026-05-04).

`cbb99fd1`'s diff (`src/core/handlers/human-extraction.ts`, `src/prompts/human/topic-scan.ts`,
`src/prompts/human/types.ts`, `tests/evals/topic-scan-duration.eval.ts`) removes the field, its
prompt instructions, its type, and its eval suite in one pass — there was no intermediate
"deprecated but present" state.

## Decision

**No numeric gate ships on topic scan. `duration` (and its predecessors `density` and `importance`)
are removed entirely, not deprecated in place.** Gating relies exclusively on the scan prompt's
existing qualitative instructions.

Verified against current source:

- `TopicScanCandidate` has exactly four fields — `name`, `description`, `category`, `reason`
  (`src/prompts/human/types.ts:57–62`). No `density`, `duration`, or `importance` field exists on
  it or anywhere else in the codebase; a repo-wide search for `duration` outside this candidate type
  turns up only unrelated timing variables (`ceremony.ts`'s local elapsed-time logging) and the
  Spotify integration's `duration_ms` — nothing topic-scan-related.
- `handleHumanTopicScan` (`src/core/handlers/human-extraction.ts:182–203`) loops over every scanned
  topic candidate and calls `queueTopicMatch` unconditionally — no threshold check, no skip branch,
  no logging of a numeric score. Every topic the LLM decides to flag is queued for matching; nothing
  filters candidates after the LLM call.
- The qualitative language the decision relies on is in the prompt today, verbatim: *"Flag a TOPIC
  when it was meaningfully discussed — not just mentioned in passing"* and *"Be **conservative**:
  only flag topics that are genuinely relevant to the human user long-term. Noise is worse than
  gaps."* (`src/prompts/human/topic-scan.ts:43,45`). The gate, such as it is, lives entirely inside
  the LLM's judgment call at scan time — there is no second, numeric checkpoint afterward.
- `getBestTopicSimilarity` (`src/core/orchestrators/human-extraction.ts:336–356`), added by
  `a6ed8c19` as a density-gate override, is still exported from the orchestrators barrel
  (`src/core/orchestrators/index.ts:14–15`) but has zero call sites anywhere in `src` today — dead
  code left behind by the one-day-lived feature it supported. ADR-017 independently documents this
  same residue in its own History section.

**`confidence` on person-scan is the contrasting case that motivated leaving topic-scan
gate-free, and it is still live today** — this is not the same field renamed, but a structurally
similar 1–5 gate on a different entity type that was kept because it earns its keep. Current
source: `PersonScanCandidate.confidence?: number` (`src/prompts/human/types.ts:72`); the prompt
instructs *"`confidence`: integer 1–5 — 1–2 = mentioned in passing, single event, no ongoing
relevance … 4–5 = clearly important, recurring presence, meaningful relationship"*
(`src/prompts/human/person-scan.ts:116–123`); and `handleHumanPersonScan`
(`src/core/handlers/human-extraction.ts:226–393`) actually enforces it: *"const confidence =
typeof candidate.confidence === 'number' ? candidate.confidence : null; if (confidence !== null &&
confidence <= 2 && !matchedPerson) { … continue; }"* (`:367–371`) — a low-confidence candidate that
doesn't match an existing person is skipped entirely, never queued for a person-creation update.
The asymmetry is the point: creating a spurious *Person* record is a distinct, costlier failure
mode (a fabricated relationship entity, potential data corruption on later merges) than a spurious
*Topic* record (a low-value entry that Validate's near-duplicate check and normal Topic maintenance
can absorb or ignore — see ADR-017). Person-scan's gate defends against a proven failure mode;
topic-scan's three gate attempts never found a numeric proxy that measured the right thing without
also discarding real signal.

## Alternatives Considered

### Alternative A: `density` — "how central is this topic to the payload?"
- **Description**: LLM scores 1–5 how central the topic is within the messages being analyzed;
  scores at or below a threshold are dropped.
- **Pros**: Cheap, single extra field on an existing scan call; simple mental model.
- **Cons**: Chunk-size-sensitive — the same conversation scores differently depending on how much
  unrelated material shares the chunk. Confirmed unreliable by direct replay (scores drifting ±1
  across runs at temperature 0.7 on an identical input).
- **Why not chosen**: The failure is structural, not tunable — no threshold fixes a score that
  depends on payload size rather than topic substance.

### Alternative B: `duration` — "how many exchanges did the human spend on this?"
- **Description**: LLM scores 1–5 how much conversational time was spent on the topic; low scores
  are dropped (or, in the last iteration before removal, logged but passed through).
- **Pros**: Not chunk-size-sensitive in the way `density` was — measures the conversation itself,
  not its share of the payload.
- **Cons**: Measures the wrong axis. Engagement length and importance are independent — a
  three-token declaration can matter more than a twenty-message conversation. The 44-case audit
  showed the scoring was self-consistent but discarded a meaningful fraction of genuine signal
  alongside genuine noise, because "brief" and "unimportant" are not synonyms.
- **Why not chosen**: Structurally answers a different question than "does this matter," which is
  the question the gate exists to answer.

### Alternative C: `importance` — "how much does this matter, based on how they engaged?"
- **Description**: LLM scores 1–5 the topic's importance to the human, evaluated but never wired
  into a production gate.
- **Pros**: On the 5 KEEP cases in the 15-case sample, performance was perfect — emotionally
  engaged, clearly-KEEP topics scored high every time.
- **Cons**: The 1 SKIP case failed via a "contagion effect": topics that are generally important to
  the person in their life (career stress, a recurring frustration) score high on *any* mention,
  even a passing one, because the topic-in-general is important — not because this particular
  mention warranted capture. `importance` measures topic salience, not per-mention engagement
  depth, and the gate needs the latter.
- **Why not chosen**: A single false-positive class on a 15-case sample is not itself
  disqualifying, but the root cause — importance and duration answer genuinely different
  questions, and neither alone is a reliable proxy for "was this meaningfully discussed right now"
  — meant shipping it alone would reproduce a version of the same mismatch that sank `duration`.
  Combining it with a duration-like signal was considered (see Reintroduction Path) but not
  attempted before the decision to ship no gate at all.

## Consequences

### Positive

- Topic-scan no longer discards real signal to LLM scoring variance on a proxy metric — the
  "Serpent's Tongue" class of failure (a meaningful topic gated out because of chunk-size or
  sampling noise) cannot recur, because there is no numeric gate left to misfire.
- One fewer field for the scan prompt to ask the LLM to produce and for the scan handler to parse
  and branch on — `TopicScanCandidate` and `handleHumanTopicScan` are simpler than they were at any
  point during the density/duration experiment (compare `cbb99fd1`'s diff, which is a net deletion
  across four files with zero replacement logic).
- The decision is falsifiable and cheap to test if reversed: nothing about the current pipeline
  (Scan → Match → Validate → Update) assumes the absence of a gate; adding one back is additive,
  not a structural change (see Reversibility).

### Negative

- Topic-scan has no automated defense against noise beyond the LLM's own judgment at scan time.
  Person-scan's `confidence` gate gives a second, independent checkpoint after the LLM call;
  topic-scan has only the one.
- The `importance` concept's promising KEEP-case performance was never revisited in combination
  with a duration-like signal (the source experiment's own next step, per Context) before the
  project moved on — the combined-gate idea in Reintroduction Path below is unvalidated, not
  disproven.
- `getBestTopicSimilarity` (`src/core/orchestrators/human-extraction.ts:336–356`) is exported dead
  code today, a residual of the one-day-lived `a6ed8c19` feature that nothing removed when the
  gate it supported was removed the next day. Low cost, but it is a small, silent trap for a future
  reader who assumes an exported, documented function has a live call site.

### Risks

- **If topic volume or noise ever does become a measured problem, there is currently no numeric
  signal left to re-derive a gate from without re-running the density/duration/importance
  experiment from scratch** — the fields, prompts, and eval fixtures that produced the 44-case and
  15-case audits were deleted along with the gate (`cbb99fd1`), not archived. Re-attempting this
  work later starts from the finding in this ADR, not from working code.
- **No evidence was found, in current source or current tests, that topic volume or noise has in
  fact become a proven problem since this decision shipped.** A search of `src/`, `docs/`,
  `CONTRACTS.md`, and the test suite for topic-count, topic-volume, or topic-noise complaints
  turned up nothing beyond this ADR's own source material and ADR-017's unrelated near-duplicate
  concern (which is about redundant *matching*, not scan-time *noise volume*, and is already
  handled by the separate Validate step). This is genuinely `it hasn't come up`, not `it has and
  was missed` — but it is also not proof that it never will; the corpus this was validated against
  was one user's history at one point in time.
- **Two different, unrelated numeric gates (person-scan's `confidence`, topic-scan's now-removed
  `density`/`duration`) were introduced in the same commit** (`e3cf13fd`), which means any future
  reader skimming that commit alone would reasonably expect both to have survived symmetrically.
  Only one did, and the reason (a proven failure mode on one side, none found on the other) is
  recorded here, not at the commit.

## Reintroduction Path

The source document's own "What to Revisit" section names two directions if topic-scan noise ever
becomes a measured problem, reproduced here since the source is being retired:

1. **A combined gate**: `importance >= 4 OR (importance >= 3 AND duration >= 3)`. This was the
   source document's own hypothesis for why `importance` and `duration` might work together where
   neither worked alone — `importance` answers "does this matter to the person," `duration`
   answers "did they engage with it just now," and the `importance` failure mode (contagion on
   generally-important-but-transiently-mentioned topics) is exactly what a duration floor would
   filter back out. **This was never implemented or evaluated** — it is a hypothesis carried
   forward from the experiment, not a design that was tried and shelved.
2. **A match-step gate**: skip the *update* call (not topic creation) when `duration <= 2 AND
   matched_guid != "new"` — i.e., a low-engagement re-mention of an *already-known* topic doesn't
   need a full update pass. The source audit data estimated roughly 20 LLM calls saved per run.
   This is the lower-risk of the two directions, because it only skips update work on topics
   already in state — it cannot suppress the creation of a genuinely new topic, which is the
   costlier mistake (a missed topic is invisible; the current architecture's asymmetric bias
   toward false negatives over false positives, echoed in ADR-017's "default to keeping both,"
   would be violated by gating *creation* rather than *update*).

Neither direction has been attempted in current source. As the Risks section above notes, no
evidence was found either way that topic volume has become a problem serious enough to justify
resuming this work — this section exists so that if it does, the next attempt starts from what the
2026-05 experiment already learned (density's chunk-size sensitivity, duration's wrong-axis
problem, importance's contagion effect) instead of re-discovering the same three dead ends.

## Reversibility

**Moderate.** Re-adding a numeric field to `TopicScanCandidate` and a check inside
`handleHumanTopicScan` is a small, mechanical change — the shape already exists as a precedent in
`PersonScanCandidate.confidence` and its enforcement in `handleHumanPersonScan`
(`src/core/handlers/human-extraction.ts:367–371`), which a reintroduction could copy structurally.
What is **not** recoverable cheaply is the evidence base: the 44-case duration audit and the
15-case importance evaluation were one-time analyses against one dataset at one point in time, and
their supporting eval fixture (`tests/evals/topic-scan-duration.eval.ts`) was deleted in `cbb99fd1`.
Re-validating any reintroduced gate means re-running that kind of audit against current data and a
current model, not restoring old numbers — model behavior on scoring tasks is explicitly called out
in Context as something that shifts with versions.

## References

- `src/prompts/human/types.ts:57–62` — `TopicScanCandidate` (no gate field), `:66–74` —
  `PersonScanCandidate.confidence`
- `src/core/handlers/human-extraction.ts:182–203` — `handleHumanTopicScan`, unconditional queue, no
  gate; `:226–393` — `handleHumanPersonScan`; `:367–371` — the live `confidence` gate
- `src/prompts/human/topic-scan.ts:43,45` — the qualitative instructions the decision relies on
  ("meaningfully discussed", "conservative … noise is worse than gaps")
- `src/prompts/human/person-scan.ts:116–123` — the `confidence` scoring rubric
- `src/core/orchestrators/human-extraction.ts:336–356` — `getBestTopicSimilarity`, dead code today
- `src/core/orchestrators/index.ts:14–15` — its barrel re-export, still present, no consumers
- Commits `e3cf13fd`, `6f316fd2`, `edcac172`, `c7d4becf`, `f2529202`, `a6ed8c19`, `3bc5e289`,
  `f9f81b0b`, `5eff152b`, `7d13bc42`, `cbb99fd1` (2026-05-02 through 2026-05-04) — the full
  implementation and removal trail, authored by Flare with Sisyphus as co-author
- ADR-017 — the Topic Validate step (near-duplicate detection), which independently documents part
  of this same commit trail and the same `getBestTopicSimilarity` dead-code residue, from the
  angle of duplicate detection rather than scan-time noise gating
- Source document (migrated by this ADR, since deleted): `.sisyphus/docs/adr-topic-scan-scoring.md`,
  dated 2026-05-04, branch `feature/density-to-duration`, status "Closed — lesson learned, feature
  removed"
