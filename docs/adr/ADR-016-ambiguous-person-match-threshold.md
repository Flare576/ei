# ADR-016: Ambiguous Person-Identity Matches Resolve Conservatively — Miss Over False-Positive Merge

## Status

Accepted

## Date

2026-08-03

## Context

Ei's person-extraction pipeline runs three stages per scanned conversation window: **Scan** (an LLM
finds people mentioned and any identifiers stated about them) → **Match** (resolve each candidate
against existing `Person` records, or decide it's someone new) → **Update** (an LLM synthesizes the
new information onto the matched record, or seeds a new one). The Match stage is a pure identity
question — "is this the same person as an existing record?" — and it is the stage this ADR is about.

Two outcomes are possible when a candidate is ambiguous: **merge it into an existing record**, or
**create a new one**. These outcomes are not symmetric in cost:

- A missed merge creates a duplicate `Person` record. This is fully recoverable — the existing
  `/dedup` command and Dedupe web UI exist specifically to find and merge these later, and merging
  two records that really are the same person is a safe, reviewable, reversible operation.
- A false-positive merge fuses two different people's data — descriptions, quotes, identifiers,
  exposure history — into one record. There is no corresponding "un-merge" primitive. Once two
  people's identifiers and quotes have been unioned onto one record, recovering which fact belonged
  to which person requires manual archaeology (see the [History](#history) section below for a case
  where this actually happened).

Given that asymmetry, the pipeline is deliberately biased toward creating duplicates over guessing
wrong. The current implementation lives in `matchPersonCandidate` and `handleHumanPersonScan`
(`src/core/handlers/human-extraction.ts:45-106,226-393`) and layers three signal types, from
strongest to weakest:

1. **Exact identifier match** (`src/core/handlers/human-extraction.ts:53-74`) — a candidate's name,
   or any identifier the scan extracted for it, exactly equals (case/whitespace-normalized via
   `normalizeForMatch`, `src/core/utils/levenshtein.ts:16-18`) an existing person's name or any of
   their stored `identifiers[]` values. Type is irrelevant here — a match on a GitHub handle counts
   the same as a match on a full name.
2. **Levenshtein fuzzy match on the candidate's name only** (`src/core/handlers/human-extraction.ts:
   78-88`) — but only when the normalized name is **at least 6 characters**; below that, fuzzy
   matching is skipped entirely (a code comment at line 78 gives the concrete reason: `"mike"` and
   `"jake"` are 2 Levenshtein edits apart, and a threshold that tolerant on short strings produces
   false-positive merges on common short names). For names that do qualify, the edit-distance
   threshold is **1 for names under 10 characters, 2 for names 10 characters or longer**
   (`human-extraction.ts:80`).
3. **First-word match** (`human-extraction.ts:92-103`) — "Lucas Jeremy Scherer" matches an existing
   "Lucas" by comparing first words, gated to first words of at least 4 characters.

Every hit from steps 1–3 is tagged `'strong'` (step 1, but only when a corroborating name-token
overlap exists — see [History](#history)) or `'weak'` (steps 2–3, always). `handleHumanPersonScan`
then routes on how many `Person` records matched and how strong the signal was
(`human-extraction.ts:254-356`):

- **Exactly one strong match** → used directly, no further check (`:258-261`).
- **Exactly one weak match** → must clear a cosine-similarity confirmation gate first
  (`confirmMatchByCosine`, `:205-224`, called at `:263` with `MULTI_MATCH_SIMILARITY_THRESHOLD =
  0.75`, defined at `:20`). Below threshold, a new record is created instead (`:217-219`).
- **More than one match (any strength)** → the candidate is embedded (name + relationship +
  description, via `getPersonEmbeddingText`) and compared by cosine similarity against every matched
  record's stored embedding; the best score must exceed `0.75` to win, otherwise a new record is
  created (`:265-290`).
- **Zero structural matches at all** → a relationship-based fallback runs (`:291-356`): if exactly
  one existing person shares the candidate's stated relationship and that relationship is in the
  hardcoded `SINGLETON_RELATIONSHIPS` set (`self`, `husband`, `wife`, `spouse`, `father`, `mother` —
  `:27-31`), it merges directly with no similarity check at all, because a person can only have one
  father. If the sole same-relationship record is instead an unnamed placeholder (name is literally
  `"Unknown"` or equals the relationship string) in a *non-singleton* relationship (e.g. the only
  `"Coworker"` record is still named `"Unknown"`), it must clear `confirmMatchByCosine` at
  `ZERO_MATCH_COSINE_THRESHOLD = 0.80` (`:21`, used at `:309`) before promoting. Any other shape —
  zero or multiple same-relationship candidates, or an unknown relationship — falls back to cosine
  search across a filtered pool (same-relationship records if there are several, otherwise every
  person with a stored embedding), again gated at `0.80` (`:334-351`).

The two cosine thresholds are deliberately different, and the difference is the point: `0.75` gates
paths that already have *some* structural signal (an exact-but-ambiguous identifier hit, a fuzzy
name hit, a first-word hit) corroborating the candidate before the embedding check ever runs. `0.80`
gates paths with **no** structural signal at all — pure relationship-plus-semantics — and is set
higher because there is nothing else backing the guess.

### History

This policy did not arrive in this shape. It went through four distinct designs, and the pendulum
swung specifically because of production data-corruption incidents, not just refactoring taste.

**2026-01-28 — LLM-only match-and-decide, cross-type (`896c0e4e`).** The original design had no
structural matching at all. `buildHumanItemMatchPrompt` (`src/prompts/human/item-match.ts`, since
deleted) dumped *every* existing Fact, Trait, Topic, and Person into one prompt and asked an LLM: "Is
this candidate the same as any of these — even across types?" and to return a `matched_guid` or
`"new"`. The system prompt explicitly invited cross-type guesses ("Juliet might be detected as a
TOPIC but should be a PERSON"). This is exactly the design the identifier-based rewrite below
replaced: a Match step that asks an LLM "does this candidate name match any of these existing
people?" — diagnosed at the time as "a fuzzy semantic reasoning problem, and LLMs are inconsistent
at it."

**2026-03-14 — split into per-type LLM match prompts (`b537c0df`, then unified pipeline removed in
`494b88c6`).** The cross-type prompt was replaced with type-specific prompts (`buildPersonMatchPrompt`
and siblings), still entirely LLM-judged, still with no structural fallback. This is the immediate
predecessor the identifier-based structural rewrite (below) replaced.

**2026-04-06, 13:36–13:37 — structural matching replaces the LLM entirely (`07d2d874`, `6540e253`,
`c939c1e4`, `ab8d9722`).** `levenshtein.ts` was added, `queuePersonMatch`/`handlePersonMatch` and the
`person-match.ts` prompt were deleted outright, and `matchPersonCandidate` shipped doing exact-value
match then Levenshtein fuzzy match at **≤2 edits for names under 8 characters, ≤3 for longer names**
— the numbers this whole redesign was built on. The design rationale recorded at the time states
directly the underlying principle this ADR is about: *"The fuzzy match thresholds should be
conservative (prefer misses over false positives). A false positive merges two different people...
Duplicates are recoverable; incorrect merges are not."*

**2026-04-06, 19:59 (`28fcc2d3`), roughly six and a half hours later, same day.** Those exact
thresholds were tightened before they saw meaningful production use: fuzzy matching was disabled
outright below 6 characters, and the surviving buckets became 1 edit under 10 characters, 2 edits at
10 or more — the values still shipping today. The original design numbers (≤2 under 8, ≤3 longer)
describe a design that was live for barely six hours before Flare tightened it; the design record
behind this change was never updated to match, which is why they were flagged as possibly stale ahead
of writing this ADR. They were.

**2026-04-07, 08:01 (`0f56dd31`), roughly 18 hours later** — embedding disambiguation added;
`matchPersonCandidate` starts returning `Person[]`. The design rationale behind this change is
explicit about why: two people sharing an identifier value (its example: two people both called
"Jared") could
match ambiguously, and exact match had been silently taking "the first hit." This commit introduced
`MULTI_MATCH_SIMILARITY_THRESHOLD = 0.75` and the multi-match cosine-disambiguation branch — and, in
the same commit, the catch-block fallback to `matches[0]` on embedding failure that this ADR's Risks
section below flags as a live inconsistency. It has been there, unchanged, since this commit.

**2026-04-07, 08:02 (`e039c6b7`), 74 seconds later.** A second threshold, `ZERO_MATCH_COSINE_THRESHOLD
= 0.80`, was added for the opposite case — zero structural signal at all — deliberately set higher
than the multi-match threshold because nothing else corroborates the guess.

**2026-04-07, 12:17 (`418cdfd8`).** `SINGLETON_RELATIONSHIPS` and the relationship-uniqueness
shortcut were added, plus first-word matching (step 2.5). The commit message states the concrete
failure mode this prevented: an unqualified relationship-uniqueness match would merge a new "David"
mention into an existing "Sisyphus" record just because both were the sole `"Coworker"` entry.

**2026-07-03 — [Issue #78](https://github.com/Flare576/ei/issues/78), "Jeff Kirk" merge bug.** Three
months of stability ended when Flare filed a bug: the confidence-gating above only covered the
*multi*-match path. A **single** match — however it was reached, including the weak first-word path
— was used with no similarity check at all. When a second, unrelated person happened to share a
first name with an existing record ("Jeff"), the pipeline silently fused the new mention into the
wrong "Jeff" the very first time it was mentioned by first name alone — not at some later ambiguous
tie-break, on first contact.

**2026-07-07, 21:50 (`d2f30839`), "Refs #78".** `matchPersonCandidate` started tagging every match
`'strong'` (exact identifier/name) or `'weak'` (fuzzy or first-word) via the `PersonMatch` /
`PersonMatchStrength` types (`human-extraction.ts:17-18`). A lone `weak` match now has to clear
`confirmMatchByCosine` at `0.75` before merging; the sole-relationship *unnamed-placeholder* case was
gated at `0.80`; genuine `SINGLETON_RELATIONSHIPS` (a real father, a real spouse) still merge
directly, unconditionally — there can only be one.

**2026-07-08, 11:12 (`cd8c952e`), "Refs #78".** A follow-up manual data-reconciliation session (the
issue's comment thread, agent-authored under Flare's account, documents untangling six already-fused
Person records — Kowsalya Jaganathan, Stanislav Makar, Mykola Pelekh, Carolyn Fry, and a
David/Dane-Evans/DJ-Moody cluster) found a *worse* hole than #78 originally diagnosed: identifiers
with **zero name-token overlap** were being cross-attributed onto the wrong person entirely (one
person's Slack handle landing on a completely different, unrelated person's record) — a failure mode
none of the strong/weak logic above could catch, because it doesn't require any string similarity at
all. The fix, `sharesNameToken` (`human-extraction.ts:33-43`), demotes an exact-identifier hit to
`'weak'` — subject to the same `0.75` cosine gate — unless the candidate's name shares an actual
token with the matched record. This closed the "bare identifier hit with zero name overlap" case
(comment at `human-extraction.ts:66-69`).

**Since 2026-07-08.** No further changes to the matching or threshold logic. Issue #78 is still
**open** on GitHub. Its comment thread's highest-leverage recommendation — deleting a blind, pre-LLM
identifier merge that used to write straight into `existingItem.identifiers` before the per-person
update LLM call ever ran (previously in `queuePersonUpdate`) — has been carried out: the current
`queuePersonUpdate` (`src/core/orchestrators/human-extraction.ts:596-671`) only ever passes
`suggested_identifiers` into the update prompt for the LLM to judge; it no longer mutates state
directly. But the issue's other recommendations — making the "don't guess an identifier from
proximity" prompt guard unconditional rather than gated to brand-new `"Unknown"` records, and adding
a negative worked example to the scan/update prompts — are not reflected in current source, and the
issue has not been closed.

## Decision

**An ambiguous person-identity match is resolved by creating a new (possibly duplicate) `Person`
record rather than merging into an existing one, whenever the available signal does not clear a
conservative threshold.** Concretely, in order:

1. An exact match on a name or stored identifier value is `'strong'` **only if** the candidate's name
   shares a token with the matched record (`sharesNameToken`, `human-extraction.ts:33-43`) —
   otherwise it's `'weak'` and must clear the same cosine gate as any other weak signal.
2. A `'weak'` structural signal (fuzzy name, first-word, or an uncorroborated identifier hit) —
   whether it's the single candidate match or the winner among several — must clear
   `MULTI_MATCH_SIMILARITY_THRESHOLD = 0.75` cosine similarity against the candidate's embedded
   `name + relationship + description` text, or a new record is created.
3. With **zero** structural signal, a relationship-based fallback may still fire, but only for a
   named record in a relationship that is definitionally singular (`SINGLETON_RELATIONSHIPS`), or
   after clearing the stricter `ZERO_MATCH_COSINE_THRESHOLD = 0.80` gate for everything else.
4. Any path that fails to clear its gate — or has no signal to check at all — creates a new `Person`
   record instead of guessing. The `/dedup` pipeline is the intended, permanent mechanism for
   reconciling the duplicates this produces; it is not treated as a stopgap that a "good enough"
   matcher will eventually make unnecessary — the design rationale behind the identifier-based
   rewrite says this directly: *"Even with better matching, duplicates will still occur... The
   dedup flow is a permanent fixture, just needs less frequent use."*

The Levenshtein fuzzy-match cutoff is **6 characters**: below that, no fuzzy match is attempted at
all, because short-name edit distances collide too easily (`"mike"`↔`"jake"` is 2 edits). At and above
6 characters, the edit-distance budget is **1 for names under 10 characters, 2 for 10 or more**
(`human-extraction.ts:78-88`).

The two cosine thresholds are asymmetric on purpose: `0.75` when some structural signal already
exists to back the guess, `0.80` when nothing else does. Note also a minor asymmetry in how each is
*compared*: `confirmMatchByCosine` (`:205-224`) accepts a score `>= threshold`, while the two inline
"best-so-far" loops (multi-match at `:274-283`, relationship-cosine-pool at `:334-342`) seed their
running maximum with the threshold itself and require a score strictly `>` it. Both encodings enforce
the same conservative boundary; this is a code-pattern quirk (using the threshold as the initial
sentinel), not a second, undocumented threshold.

## Alternatives Considered

### Alternative A: LLM-only match-and-decide (the original design, `896c0e4e` → `494b88c6`)

- **Description**: Ask an LLM directly whether a candidate matches any existing record — the
  approach that shipped first and that the identifier-based structural rewrite (below) replaced.
- **Pros**: No structural matching code to write or maintain; handles genuinely fuzzy cases ("Bob"
  vs. "Robert") without an explicit rule.
- **Cons**: The diagnosis behind moving off it, later validated in practice: "That's a fuzzy semantic reasoning
  problem, and LLMs are inconsistent at it — especially when names are ambiguous." Every LLM match
  failure or hedge created a duplicate, and every over-eager LLM guess merged two different people
  with no way to inspect *why* it decided that.
- **Why not chosen**: People are not a semantic-reasoning problem the way Topics are ("Sisyphus" is
  either the same Sisyphus or it isn't) — a structured lookup over `identifiers[]` is strictly more
  auditable and reproducible than a natural-language judgment call, once identifiers exist as a
  first-class schema field to look them up by.

### Alternative B: Levenshtein-only structural matching, no embedding fallback (the design that shipped for ~18 hours, `ab8d9722` → `0f56dd31`)

- **Description**: Exact-identifier match, then a single Levenshtein fuzzy pass, first hit wins — no
  cosine similarity anywhere.
- **Pros**: Zero dependency on the embedding service; fully synchronous; trivially fast.
- **Cons**: No way to disambiguate when a candidate genuinely matches more than one record (two
  people sharing an identifier value — the exact scenario that motivated this fix) — the first hit silently won,
  which is exactly the kind of guess the conservative policy exists to prevent.
- **Why not chosen**: Once `identifiers[]` values can legitimately collide across two different real
  people, "first match wins" with no confirmation is a false-positive-merge machine. The very next
  morning's commit replaced it with cosine disambiguation.

### Alternative C: One shared cosine threshold for every ambiguity shape

- **Description**: Use a single similarity cutoff (e.g. `0.75` for everything, or `0.80` for
  everything) rather than two different numbers depending on whether structural signal already
  exists.
- **Cons**: Collapses two genuinely different confidence situations into one number. A weak
  structural hit (a fuzzy name, a first-word match) already carries information a pure "zero
  matches, guess from relationship + semantics" case does not; using the same bar for both either
  makes the well-corroborated case too strict or the uncorroborated case too permissive.
- **Why not chosen**: The two-threshold split (`0.75` vs `0.80`) is exactly what shipped
  (`e039c6b7`) specifically because zero-structural-signal matching needed to be held to a stricter
  bar than signal-corroborated matching.

### Alternative D: Merge on any single structural match, gate only ties (the design that shipped for ~3 months, `418cdfd8` → Issue #78)

- **Description**: Only run a cosine confirmation when more than one candidate structurally
  matched; a single match of any strength (including a bare first-word hit) merged unconditionally.
- **Cons**: This is what produced the Jeff Kirk merge bug (Issue #78) — a first-name-only match with
  zero corroboration merged into an unrelated existing record the first time it occurred, not at some
  later disambiguation point. The follow-up reconciliation session in the same issue found a second,
  independent hole: identifier cross-attribution with zero name-token overlap, which no
  strength-tagging in the original fix could catch.
- **Why not chosen**: Directly refuted by production data corruption. Replaced by the
  strong/weak-tagged matches plus `sharesNameToken` corroboration gate (`d2f30839`, `cd8c952e`)
  described in [History](#history).

## Consequences

### Positive

- The failure mode this policy accepts (a duplicate `Person` record) is cheap and fully reversible
  through an existing, permanent tool (`/dedup`); the failure mode it refuses to risk (a silent
  identity fusion) has no corresponding repair primitive today.
- Every threshold in the pipeline is a plain constant or comparison in one function
  (`human-extraction.ts:20-21,27-31,79-88,254-356`) — auditable and tunable without touching an LLM
  prompt, unlike the original design this replaced.
- The policy has demonstrably self-corrected under real production evidence twice (Issue #78's two
  distinct root causes) rather than needing a redesign — the strong/weak match-strength model and the
  `sharesNameToken` corroboration gate were both incremental tightenings of the same architecture, not
  replacements of it.

### Negative

- Duplicate `Person` records are an accepted, ongoing cost, not an edge case: the pipeline is tuned
  to produce them whenever a match is ambiguous. `/dedup` usage is a permanent operational burden this
  decision creates, not a temporary bridge — the design rationale for this decision says so
  explicitly.
- `SINGLETON_RELATIONSHIPS` (`human-extraction.ts:27-31`) merges directly with **no** cosine
  confirmation at all when its narrow condition is met — a real, differently-named person sharing a
  singleton relationship label (e.g. a second "Father" mention that is somehow not the same father)
  would merge unconditionally. This is intentional (a person can only have one father) but it is the
  one path in the whole matcher that is not gated by the conservative-by-default policy at all.
- The dual-threshold design (`0.75` vs `0.80`, plus the `>=`-vs-`>` sentinel-comparison quirk noted in
  the Decision section) is not self-documenting; a future maintainer changing one number without
  reading both call sites could silently change which failure mode the pipeline favors.

### Risks

- **Live inconsistency: embedding-service failure does not follow this ADR's own decision.** The
  multi-match branch (`human-extraction.ts:265-290`) is the only path in the matcher with a
  `try`/`catch` around the embedding call. On success with no candidate clearing `0.75`, it correctly
  creates a new record (`:284-286`, consistent with this ADR). **On a thrown exception — the
  `catch` at `:287-290` — it falls back to `matchedPerson = matches[0].person`: the first structurally
  matched record, unconditionally, regardless of match strength or similarity.** This is the exact
  outcome this ADR's decision exists to prevent: an ambiguous match, resolved with the least
  information available (no embedding was ever compared), merged rather than deferred to a new
  record. The embedding service is not decorative here — it lazily loads a `fastembed` model on first
  use and downloads/caches it to disk (`src/core/embedding-service.ts:230-250`), a dynamic import and
  first-run download that can genuinely fail (missing dependency, no network, cache-directory
  permission error) — so this is a reachable path, not a theoretical one. Every other
  embedding-failure path in this file fails safe: `confirmMatchByCosine`'s `catch`
  (`human-extraction.ts:220-223`) returns `null` (→ new record), and the zero-structural-match cosine
  pool's `catch` (`:349-351`) leaves `matchedPerson` at its initialized `null` (→ new record). The
  multi-match branch is the sole exception, and it has been exactly this way, unreviewed, since the
  branch was introduced in `0f56dd31` on 2026-04-07 — it predates even the Issue #78 hardening and was
  not touched by either of that issue's fixes. This is flagged here as a known, live gap, not resolved
  by this ADR.
- **Issue #78 is still open.** The corroboration and confidence-gating fixes that shipped against it
  (`d2f30839`, `cd8c952e`) address the two root causes identified so far. The issue's own
  recommendation to make the "don't guess an identifier from conversational proximity" prompt
  instruction unconditional (currently gated to brand-new `"Unknown"` records only,
  `src/prompts/human/person-update.ts`) has not shipped. Nothing in this ADR's mechanism catches a
  cross-attribution that happens at the *scan* LLM call itself, before any of this matching code ever
  runs — the matcher can only be as correct as the identifiers the scan handed it.
- **The exact threshold values are unvalidated against a labeled dataset.** Every number in this
  document (`6`, `10`, `1`, `2`, `0.75`, `0.80`, `4`-char first-word cutoff) was chosen by inspection
  and tightened reactively after specific incidents (see History), not derived from a precision/recall
  study against real person-matching data. They are plausible, not proven optimal.

## Reversibility

Moderate. Every threshold is an isolated constant or comparison
(`human-extraction.ts:20-21,79-80,304,309,334`) and can be retuned without a data migration — no
`Person` record encodes which threshold matched it. What is **not** reversible after the fact: once a
false-positive merge has happened under a looser threshold, the two people's data is fused in the
stored record with no marker distinguishing which fact came from which person (this is precisely what
made the Issue #78 reconciliation session manual, quote-by-quote archaeology rather than a mechanical
undo). Tightening a threshold going forward prevents new instances of a failure mode; it does nothing
for records already merged under the old one. `/dedup`'s split primitive, if one is ever built, would
change this — none exists today.

## References

- `src/core/handlers/human-extraction.ts:17-21,27-43,45-106,205-224,226-393` — `PersonMatch`/
  `PersonMatchStrength` types, threshold constants, `SINGLETON_RELATIONSHIPS`, `sharesNameToken`,
  `matchPersonCandidate`, `confirmMatchByCosine`, `handleHumanPersonScan`
- `src/core/utils/levenshtein.ts` — `levenshtein`, `normalizeForMatch`
- `src/core/embedding-service.ts:61-63,143-153,210-281` — `getPersonEmbeddingText`,
  `getEmbeddingService`, the lazy `fastembed`-backed Bun implementation whose first-use model load can
  fail
- `src/core/orchestrators/human-extraction.ts:596-671` — current `queuePersonUpdate`, which no longer
  blind-merges identifiers ahead of the per-person update LLM call
- [Issue #78](https://github.com/Flare576/ei/issues/78) — "Jeff Kirk" merge bug, the production
  incident that produced the strong/weak match-strength model and the `sharesNameToken` corroboration
  gate; open as of this writing
- Commits: `896c0e4e` (2026-01-28), `b537c0df`, `494b88c6` (2026-03-14), `07d2d874`, `6540e253`,
  `c939c1e4`, `ab8d9722`, `28fcc2d3` (2026-04-06), `0f56dd31`, `e039c6b7`, `418cdfd8` (2026-04-07),
  `d2f30839` (2026-07-07), `cd8c952e` (2026-07-08) — see [History](#history) for what each changed
