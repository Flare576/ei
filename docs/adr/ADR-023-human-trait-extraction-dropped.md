# ADR-023: Human Trait Extraction Dropped

## Status

Accepted

## Date

2026-08-03

## Context

Ei extracts several kinds of knowledge about the human it serves, and current source shows exactly
four active categories, each with its own queue function in the human-extraction orchestrator:
`queueFactFind`, `queuePersonScan`, `queueTopicScan`, and `queueEventSummary`
(`src/core/orchestrators/human-extraction.ts:100,150,195,502`). `queueAllScans`, the entry point
that fires all of them together, calls exactly these four and nothing else:

```
queueFactFind(context, state, options);
queuePersonScan(context, state, options);
queueTopicScan(context, state, options);
queueEventSummary(context.personaId, state, options);
```

(`src/core/orchestrators/human-extraction.ts:257-262`). There is no fifth call for anything
trait-shaped.

This is corroborated at the message level. `Message`'s extraction-completion flags are single
letters chosen to minimize storage overhead across large histories, and today there are exactly
four:

```
f?: boolean;                 // Fact extraction completed
t?: boolean;                 // Topic extraction completed
p?: boolean;                 // Person extraction completed
e?: boolean;                 // Event (epic) extraction completed
```

(`src/core/types/llm.ts:19-22`). A ceremony comment makes the absence explicit rather than
accidental — the completion check for "has this message been fully processed" reads:

```
const fullyExtracted = m.t && m.p && m.f; // r intentionally excluded — trait extraction deprecated
```

(`src/core/orchestrators/ceremony.ts:368`). The `r` the comment refers to is a retired flag from
when a human-trait scan existed; it is not part of the current `Message` shape, and its absence
from the four-flag list above is the deprecation, not an oversight the comment is warning about.

The type system agrees: `HumanEntity` — the record of everything Ei knows about the person it
serves — has exactly four content arrays, and none of them is traits:

```
export interface HumanEntity {
  entity: "human";
  facts: Fact[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
  last_updated: string;
  settings?: HumanSettings;
}
```

(`src/core/types/entities.ts:146-154`). The corrections surface — the only way any of this data can
be created, edited, or removed after extraction — matches: `CorrectableType` is
`"fact" | "topic" | "person" | "quote" | "persona"` and `assertValidCorrection()` rejects any other
string (`CONTRACTS.md:282`). There is no `"trait"` entry for anything on the human side.

**This is not the same concept as `PersonaTrait`, which is unaffected and actively used.** Ei's own
personas (Beta, Sisyphus, and the rest) carry a `traits: PersonaTrait[]` field
(`src/core/types/entities.ts:166`) that defines a persona's own character — playful, terse, whatever
the persona is — and is populated and maintained by a completely separate, live pipeline:
`HandlePersonaTraitExtraction` (`src/core/types/enums.ts:35`), the persona-generation orchestrator
that merges LLM-proposed traits with user-provided ones by name
(`src/core/handlers/persona-generation.ts:23-58`), and the reflection critic that sanitizes and
writes back a persona's `traits` array after a heartbeat cycle
(`src/core/handlers/heartbeat.ts:168-184`). `DataItem`, the union of everything a *human* fact-find
or scan can produce, is `Fact | PersonaTrait | Topic | Person` (`src/core/types/data-items.ts:96`) —
`PersonaTrait` appears there only because personas themselves are edited through the same
corrections dispatch, not because a human can have one. This ADR is exclusively about the dropped
category — automatic extraction of behavioral/psychological traits *about the human Ei is learning
about* (e.g. "type of learner," "social comfort level") — and says nothing about, and does not
affect, `PersonaTrait`.

**Why it was dropped, in the project owner's own words:** extraction quality was garbage — near-zero
signal-to-noise ratio — and there was no actual use case for what little signal was extracted. The
feature's original premise came from an earlier version of the product: Ei was, at one point, being
designed as an emotional-awareness tool or an education tool, where knowing a user's "type of
learner" or "social comfort level" would have had real, load-bearing purpose — it would have
directly shaped how Ei taught or how Ei calibrated emotional support. Ei did not evolve in that
direction. Once the product direction changed, the feature lost the reason it existed; it kept
running on inertia, producing mostly noise, feeding a use case that no longer existed. Dropping it
was a consequence of the product no longer being the tool the feature was built for — not a
standalone quality fix to an otherwise-wanted feature.

## Decision

**Automatic extraction of human behavioral/psychological traits is not implemented and is not
currently scheduled.** No `HumanTrait` type, handler, enum member, or scan path exists anywhere in
current source:

- `queueAllScans` queues exactly fact, person, topic, and event scans — no trait scan
  (`src/core/orchestrators/human-extraction.ts:257-262`).
- `Message` extraction flags are `f | t | p | e` — no fifth flag for a human trait scan
  (`src/core/types/llm.ts:19-22`); the retired `r` flag is explicitly called out as gone, not
  present-but-unused (`src/core/orchestrators/ceremony.ts:368`).
- `HumanEntity` has no `traits` field — `facts`, `topics`, `people`, `quotes` only
  (`src/core/types/entities.ts:146-154`).
- `CorrectableType` has no `"trait"` entry for the human side (`CONTRACTS.md:282`).
- `src/prompts/human/` — the directory holding every human-facing extraction prompt — contains
  `fact-find.ts`, `person-scan.ts`, `person-update.ts`, `topic-scan.ts`, `topic-update.ts`,
  `topic-match.ts`, and `event-scan.ts`. There is no `trait-find.ts` or equivalent.

This is a decision to leave the capability absent, not a bug to fix or a gap to fill on the next
pass. If a real use case for this information emerges later, it should be re-evaluated from scratch
against that use case (see **Reintroduction Path** below) — not resurrected as a generic
re-enablement of the old category.

`PersonaTrait` — the character traits of Ei's own personas — is a separate, unaffected concept and
is explicitly out of scope for this decision. It continues to be actively extracted, merged, and
maintained by its own pipeline (`src/core/handlers/persona-generation.ts`,
`src/core/handlers/heartbeat.ts:168-184`, `HandlePersonaTraitExtraction` in
`src/core/types/enums.ts:35`).

## Alternatives Considered

### Alternative A: Improve extraction quality instead of dropping the category

- **Description**: Keep human trait extraction, but invest in better prompting, a stricter
  explicit-statement standard (matching the discipline `fact-find.ts` already applies — see
  Reintroduction Path), or a higher-quality model tier, to raise the signal-to-noise ratio.
- **Cons**: This treats the problem as purely a quality bug. It was not — the stated rationale is
  that there was no actual use case for the signal even when some was extracted. Fixing extraction
  quality without a use case produces cleaner noise, not value.
- **Why not chosen**: Addresses the wrong half of the problem. The use case, not the extraction
  quality, was the load-bearing failure.

### Alternative B: Leave the code paths in place but dormant (feature-flagged off)

- **Description**: Keep `HumanTrait`-equivalent types, handlers, and scan wiring intact, gated
  behind a settings flag defaulting to off, so re-enabling later is a flag flip rather than new
  work.
- **Cons**: Dormant extraction code rots exactly like any other unused code path — it drifts out of
  sync with the schema, prompt conventions, and corrections dispatch around it (the "Fact/trait/…"
  comment still surviving in `src/prompts/AGENTS.md:14` after the removal already shows how quickly
  a stale reference outlives the thing it described). A flag also implies the category itself is the
  right shape to re-enable, when the actual conclusion — see Reintroduction Path — is that the old
  shape (a dedicated extraction category, continuously re-inferred) was itself part of the problem,
  not just its quality.
- **Why not chosen**: Keeping a wrong-shaped feature dormant costs real maintenance for a
  reactivation path nobody intends to use as-is.

### Alternative C: Keep a single `Trait` type shared between humans and personas

- **Description**: Instead of splitting into `PersonaTrait` (kept) and a human-side trait type
  (dropped), keep one shared `Trait` interface usable by either entity, and simply stop calling the
  human-side extraction functions.
- **Cons**: A shared type invites exactly the conflation this ADR is written to prevent — "does this
  `Trait` describe a person Ei is learning about, or Ei's own persona's character?" becomes a
  runtime question instead of a type-level one. `DataItemBase`'s common fields
  (`src/core/types/data-items.ts:7-22`) already cover what little structure the two would have
  shared, so the type split costs nothing and buys a permanent, compiler-checked distinction.
- **Why not chosen**: The rename to `PersonaTrait` (the type actually in source today,
  `src/core/types/data-items.ts:28-30`) removes the ambiguity at the type level instead of relying on
  every future reader to keep the distinction straight by convention.

### Alternative D: Extract silently for future use, without surfacing anywhere

- **Description**: Keep running trait extraction in the background — write results into storage —
  but never expose them in web/TUI/CLI, on the theory that the data might be useful once a use case
  materializes.
- **Cons**: This is the worst of both worlds against the stated rationale: it keeps paying the
  near-zero signal-to-noise extraction cost indefinitely, accumulates low-quality data nobody
  reviews or corrects (the corrections surface has no `"trait"` entity type to fix it with,
  `CONTRACTS.md:282`), and defers the actual design question — what shape should this take if it
  ever matters — instead of answering it.
- **Why not chosen**: Silent accumulation of unreviewable low-signal data is a liability, not a
  hedge; by the time a use case exists, the accumulated data would need re-validation anyway,
  making the accumulation itself worthless.

## Consequences

### Positive

- No LLM budget, queue slots, or chunking work is spent extracting a category with near-zero
  signal-to-noise ratio and no consuming use case — `queueAllScans` does four scans, not five
  (`src/core/orchestrators/human-extraction.ts:257-262`).
- The type system enforces the human/persona trait distinction structurally: `PersonaTrait` exists
  only on `PersonaEntity.traits` (`src/core/types/entities.ts:166`); nothing on `HumanEntity` can be
  confused with it, because `HumanEntity` has no comparable field
  (`src/core/types/entities.ts:146-154`).
- `Message`'s extraction-flag bookkeeping stays smaller — four single-letter flags instead of five —
  which matters because the comment on those flags says the single-letter naming exists
  specifically to minimize storage overhead across large message histories
  (`src/core/types/llm.ts:17-18`).

### Negative

- The module-level documentation comment for `src/prompts/human/` still reads
  `# Fact/trait/topic/person extraction` (`src/prompts/AGENTS.md:14`), even though no trait-related
  prompt file exists in that directory today. A reader of that doc comment alone, without checking
  the directory listing, would believe trait extraction is live.
- The retired `r` message-extraction flag is discoverable only through one comment
  (`src/core/orchestrators/ceremony.ts:368`) explaining why it is *excluded* from a completion check
  — there is no single place documenting that a human-trait category existed and was removed, apart
  from that comment and this ADR.
- Anyone who previously relied on the emotional-awareness/education framing that motivated the
  original feature (see Context) has no automatic replacement today; any product work in that
  direction currently has zero supporting extraction infrastructure to build on.

### Risks

- **The stale doc comment could mislead a future contributor into re-adding scan wiring that
  assumes a directory structure (`trait-find.ts`, a fifth extraction flag) that no longer matches
  current conventions.** The fix is a one-line doc correction, but nothing forces it to happen before
  someone reads the stale comment and acts on it.
- **Nothing prevents a future contributor from reintroducing this as a dedicated extraction
  category rather than the shape recommended below**, if the doc trail (this ADR aside) does not
  make the intended reintroduction shape clear at the point someone next considers building it.

## Reintroduction Path

If a real use case for this kind of information (e.g. "type of learner," "social comfort level")
ever arises again, the stated intent is **not** to rebuild a dedicated extraction category — no new
`HumanTrait` type, no new `Message` flag, no new scan function in `human-extraction.ts`. Instead,
traits would be **special-cased Facts**: added to the existing `BUILT_IN_FACTS` list and captured
through the existing fact-find pipeline, exactly like "Marital Status" or "Field of Study" are
today.

Concretely, this already fits the current Fact architecture with no new mechanism:

- `BUILT_IN_FACTS` is a flat, uncapped array of `{ name: string }` entries — the module comment
  states there is deliberately "no hard limit — keep it to a reasonable set of information a human
  would actually want an Agent or Persona to remember, not a number"
  (`src/core/constants/built-in-facts.ts:6-12`). Adding e.g. `{ name: "Learning Style" }` or
  `{ name: "Social Comfort Level" }` is a one-line addition to this list, not a schema change.
- `queueFactFind` only asks the LLM to look for facts whose stored `description` is currently empty:
  `human.facts.filter(f => !f.description || f.description === "").map(f => f.name).filter(name =>
  BUILT_IN_FACT_NAMES.has(name))` (`src/core/orchestrators/human-extraction.ts:113-116`). This means
  a special-cased trait-Fact would be **captured once** and then structurally excluded from every
  future scan the moment it has a value — there is no re-inference step to disable, because
  fact-find already only ever looks for *missing* facts, never re-evaluates ones it already has.
  This is precisely the "captured once, not continuously re-extracted" behavior the reintroduction
  should have, and the current pipeline provides it for free.
- `fact-find.ts`'s extraction prompt already enforces the discipline this would need: it instructs
  the model to extract **only explicit statements**, never inference — "Do not infer, assume, or
  guess based on context or general knowledge" (`src/prompts/human/fact-find.ts:29`) — and to expect
  that the overwhelming majority of scans return nothing: "99.99999% of the time, you will return no
  data — don't try to force it" (`src/prompts/human/fact-find.ts:24`). A trait-as-Fact would inherit
  this explicit-statement-only standard automatically, rather than needing a new prompt built from
  scratch with its own quality bar to get right.
- Once captured, the value is a normal `Fact` (`extends DataItemBase`, `src/core/types/data-items.ts:
  24-26`), which already supports full user-driven maintenance through the existing corrections
  surface: `fact` is one of the three types with `create`/`update`/`remove` all `yes`
  (`CONTRACTS.md:286`). No new corrections op, CLI verb, or MCP tool would be needed for the user (or
  an agent acting on the user's behalf) to correct or edit it going forward — exactly the "left for
  the user themselves to maintain/edit" behavior called for, using the mechanism that already exists
  for every other Fact today.

In short: the reintroduction target is not "bring back trait extraction," it is "treat a trait as
one more named Fact." The one-time-capture and user-maintained-afterward behavior this would need is
not new work to build — it already falls out of how `queueFactFind` and the Fact corrections path
work today. The only real design work left, if this is ever picked back up, is choosing *which*
trait-shaped names belong in `BUILT_IN_FACTS` and confirming the explicit-statement extraction
standard actually surfaces the intended signal for whatever concrete use case motivates it.

## Reversibility

**Cheap for the recommended shape, moderate for the old shape.** Adding a trait as a special-cased
`BUILT_IN_FACTS` entry (the recommended reintroduction, above) is additive and low-risk: no schema
migration, no new type, no new corrections op — it reuses `Fact`, `queueFactFind`, and the existing
corrections dispatch as-is. Rebuilding the *old* shape — a dedicated `HumanTrait` type, a fifth
`Message` flag, a standalone scan function — is real but bounded work: `PersonaTrait`
(`src/core/types/data-items.ts:28-30`) is a template for the type shape, `queueTopicScan` /
`queuePersonScan` (`src/core/orchestrators/human-extraction.ts:150-255`) are templates for the scan
wiring, and `CorrectableType` (`CONTRACTS.md:282`) would need a new entry to make such traits
user-editable. Neither path requires touching data written under this decision, because there is no
data written under this decision — extraction never ran, so there is nothing to migrate or
reconcile.

## References

- `src/core/orchestrators/human-extraction.ts:100,150,195,257-262,502` — `queueFactFind`,
  `queuePersonScan`, `queueTopicScan`, `queueAllScans` (exactly four scans), `queueEventSummary`
- `src/core/orchestrators/ceremony.ts:368` — the retired `r` flag comment: "trait extraction
  deprecated"
- `src/core/types/llm.ts:17-23` — `Message`'s four extraction-completion flags (`f`, `t`, `p`, `e`)
- `src/core/types/entities.ts:146-154,156-168` — `HumanEntity` (no `traits` field) vs.
  `PersonaEntity.traits: PersonaTrait[]`
- `src/core/types/data-items.ts:7-22,24-30,96` — `DataItemBase`, `Fact`, `PersonaTrait`, and the
  `DataItem` union
- `CONTRACTS.md:282,286` — `CorrectableType` (no human-side `"trait"` entry) and the
  fact/topic/person shared-schema corrections row
- `src/core/constants/built-in-facts.ts:1-53` — `BUILT_IN_FACTS`/`BUILT_IN_FACT_NAMES`, the
  uncapped list a reintroduced trait would join
- `src/prompts/human/fact-find.ts:14-45` — the explicit-statement-only extraction discipline a
  trait-as-Fact would inherit
- `src/prompts/AGENTS.md:14` — the stale `human/` directory doc comment still mentioning "trait"
  extraction
- `src/core/types/enums.ts:35` — `HandlePersonaTraitExtraction`, the unaffected persona-side pipeline
- `src/core/handlers/persona-generation.ts:23-58` and `src/core/handlers/heartbeat.ts:168-184` — the
  live `PersonaTrait` merge/sanitize pipeline, unaffected by this decision
