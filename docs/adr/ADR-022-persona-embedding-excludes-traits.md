# ADR-022: Persona Description Embedding Excludes Traits

## Status

Accepted

## Date

2026-08-03

## Context

Every `PersonaEntity` carries an optional `description_embedding: number[]`
(`src/core/types/entities.ts:180`), computed by
`computePersonaDescriptionEmbedding` (`src/core/embedding-service.ts:113-125`) from the text
`getPersonaDescriptionText` builds (`src/core/embedding-service.ts:104-111`):

```ts
export function getPersonaDescriptionText(persona: {
  display_name: string;
  long_description?: string;
  short_description?: string;
}): string {
  const desc = persona.long_description ?? persona.short_description;
  return [persona.display_name, desc].filter(Boolean).join(' - ');
}
```

The input text is `display_name` plus `long_description` (falling back to `short_description` when
absent). `PersonaEntity.traits` — the persona's `PersonaTrait[]` array — is never read by this
function. The type comment at `entities.ts:180` records this as a fact: *"Embedding of
long_description (short_description fallback). Excludes traits."* Neither that comment nor the
commit that introduced the field explains *why*.

### Where this field actually gets read today

`description_embedding` is not a vestigial field nobody consults. It backs
`retrievePersonasSemantic` (`src/cli/retrieval.ts:321-340`), the third and last tier of persona
lookup:

```ts
export async function retrievePersonasSemantic(
  queryVector: number[],
  state: StorageState,
  limit: number = 10,
): Promise<PersonaResult[]> {
  const personaList = Object.values(state.personas).map((p) => p.entity);
  const withEmbeddings = personaList
    .filter((p): p is PersonaEntity & { description_embedding: number[] } => Array.isArray(p.description_embedding) && p.description_embedding.length > 0)
    .map((p) => ({ id: p.id, embedding: p.description_embedding, _entity: p }));
  // ... findTopK against queryVector, filtered by EMBEDDING_MIN_SIMILARITY (retrieval.ts:27)
}
```

`execute()` in `src/cli/commands/personas.ts:6-35` is the entry point for the `ei personas <query>`
CLI command (`persona`/`personas` alias mapping at `src/cli.ts:40-41`, dynamic dispatch to
`commands/personas.js` at `src/cli.ts:711-712`) and is reached identically from the MCP `ei_search`
tool when called with `type: "personas"` (same dynamic-import dispatch at `src/cli/mcp.ts:118-120`).
It runs a strict three-tier fallback, falling through only when the previous tier is empty:

1. **Name match** — `retrievePersonas` (`retrieval.ts:289-319`), a case-insensitive substring match
   against `display_name`.
2. **Reverse-containment match** (`personas.ts:18-29`) — handles a query longer than the stored
   name (e.g. `"Beta — QA Goddess"` against a stored `"Beta"`).
3. **Semantic search** — `retrievePersonasSemantic` against `description_embedding`
   (`personas.ts:31-34`).

Test coverage for the semantic tier lives in the `retrievePersonasSemantic` describe block
(`tests/unit/cli/retrieval.test.ts:743-774`): empty-when-no-embeddings, non-empty when an embedding
is present, `limit` respected, and empty when nothing clears `EMBEDDING_MIN_SIMILARITY`.

### Where this field gets written today

`description_embedding` is recomputed, from scratch, on every write path that can change
`long_description`:

- **CLI/MCP persona create** — `createPersonaEntity` (`src/cli/persona-corrections.ts:290-365`)
  computes it once at `persona-corrections.ts:347-349` if `long_description` was supplied.
- **CLI/MCP persona update** — `updatePersonaEntity` (`persona-corrections.ts:367-442`) always
  recomputes at `persona-corrections.ts:430-432` rather than diffing old vs. new, "simplest correct
  behavior, and cheap (local embedding model, no network call)" per the comment immediately above
  the call. `description_embedding` is one of the fields `PERSONA_ROUND_TRIP_FIELDS`
  (`persona-corrections.ts:143-187`) strips from a caller's input payload before validation — a
  caller can never set it directly; only the server-computed value survives.
- **Internal state mutation** — `updatePersona` (`src/core/persona-manager.ts:124-153`), reached
  from `Processor.updatePersona` and `Processor.finalizeReflection`
  (`src/core/processor.ts:1324-1327,1329-1364`), recomputes only when `'long_description' in
  updates`, asynchronously, and guards against a stale write landing after a second concurrent edit.
  `finalizeReflection` is the `/reflect apply` path: accepting a Critic's proposed identity
  revision writes a new `long_description` (among other fields) through this exact path, so
  accepting a reflection always refreshes the embedding.

This is a live, currently-exercised field on both the read and write side, not backfill guesswork
about dead code.

### Why traits, specifically, are excluded — what the record actually shows

The field, `getPersonaDescriptionText`, and `computePersonaDescriptionEmbedding` were all
introduced together in one commit, `1384e044` (2026-04-06), *"feat: detect persona identity drift
and surface reflection opportunity in heartbeat"*. That commit's message describes what the
feature does — computes `description_embedding` for personas, compares it against the linked
human's `People` record embedding, and surfaces a reflection prompt in the heartbeat check when
similarity drops below 0.80 — but it says nothing about traits. `git log -L` on the `entities.ts`
comment line confirms it has not been edited since that same commit; the "Excludes traits" wording
was written once, at introduction, and never touched again. A repository-wide `git grep` across
every commit reachable from any ref for language resembling a stated rationale (phrases like
"universal seed" or "behavioral constraint") returns nothing. **The git history and the current
code comment record *that* traits are excluded; neither records *why*.**

The "why" does exist, though — it was written down at design time, contemporaneously with the
`1384e044` commit, in this feature's implementation planning notes. Those notes never made it into
the commit message or the type comment, and (being local planning material, not project source)
they are not part of the durable, shared repository history this ADR is grounded in — so this ADR
is, as far as the tracked repository record shows, the first durable place this reasoning is
recorded. Reproduced directly, the stated reasoning was:

> Inspecting real persona data reveals three trait categories: identity descriptors (e.g.
> "Aggressive Critical Testing", "Dry Zero-BS Humor", "Fiercely Loyal") — useful signal; behavioral
> constraints (e.g. "Avoid Financial/Technical Speculation...", "No Repetition") — rules, not
> identity; and seed traits (e.g. "Genuine Responses", "Natural Speech") that appear in every
> persona — universal noise that would make all embeddings more similar. There is no programmatic
> way to distinguish these categories. Including all traits degrades embedding quality and risks
> both false positives (a new behavioral rule looks like identity drift) and false negatives
> (universal seed-trait noise masks real drift). The comparison target, `Person.description`, is a
> prose identity narrative that aligns with `long_description`, not with mixed behavioral rules.

Two structural facts in current source corroborate this independently of the recovered notes:

- **No category discriminator exists on a trait, then or now.** `PersonaTrait` is `DataItemBase`
  (`id`, `name`, `description`, `sentiment`, ... — `src/core/types/data-items.ts:7-22`) plus an
  optional `strength` (`data-items.ts:28-30`). There is no `category`/`type` field anywhere on it
  that could separate "identity descriptor" from "behavioral constraint" from "seed trait" — the
  "no programmatic way to distinguish these categories" claim still holds today, verified against
  the type itself.
- **The named "seed trait" example is real, current, and universal.** `DEFAULT_SEED_TRAITS`
  (`src/core/constants/seed-traits.ts:8-29`) defines exactly `"Genuine Responses"` and `"Natural
  Speech"`, and every persona receives them: `processor.ts:1114-1117,1137-1140` back-fills any
  persona missing them by name on every hydration, and `src/core/personas/opencode-agent.ts:57-63`
  seeds them at creation time. Any embedding built from raw trait text would carry this identical
  substring in every persona's vector — exactly the "universal noise that would make all embeddings
  more similar" failure mode described above.
- **The comparison target (`Person.description`) structurally has no trait-equivalent field.**
  `Person` (`data-items.ts:65-95`) has no `traits` array at all, and its embedding is built by
  `getPersonEmbeddingText` (`embedding-service.ts:61-63`, `name + relationship + description`,
  computed at write time in `src/core/handlers/human-matching.ts:259-260` and
  `human-extraction.ts:213-215,268-271,327-330`) — pure prose, nothing rule-shaped mixed in. Pairing
  it against a persona embedding built the same way (prose only, no rules) is the only apples-to-
  apples comparison available.

The recovered reasoning is presented above as the actual design rationale, not as this ADR's own
inference — it is a real historical fact, just one that lived only in ephemeral planning material
until now. Anything beyond it in this document that draws a new conclusion is marked
`[INFERENCE]` explicitly.

**`[INFERENCE]`** The original consumer this exclusion was tuned for — heartbeat drift detection
against `Person.description` — was removed entirely in `705e33c2` (2026-04-23, *"feat: add persona
reflection ceremony phase and HandleReflectionCritic handler"*), replaced by the `pending_update`
mechanism (a Critic proposes a full identity revision; the persona surfaces it explicitly rather
than an automatic similarity check). `description_embedding` itself was not deleted alongside its
original consumer. Three days later, `a97703d0` (2026-04-27, *"fix(mcp): persona lookup and
semantic search"*) gave it an entirely new, unrelated consumer: `retrievePersonasSemantic`, backing
free-text persona lookup. `dac2786f` (2026-05-13) later narrowed *where* that consumer fires
(excluded from `retrieveBalanced`'s default results, reachable only via the explicit `ei personas`
command or `ei_search(type="personas")`) without touching the embedding composition itself. Most
tellingly, `928d8b93` (2026-07-09, *"fix(core): preserve last_heartbeat and drop dead reflection
fields from PersonaEntity"*) explicitly audited `PersonaEntity` for dead fields — removing
`reflection_last_asked` and `last_extraction` with commit-message justification citing "zero live
call sites in src/, confirmed via git history" — and left `description_embedding` alone. That
audit is the closest thing in the tracked history to an explicit confirmation that this field is
still live: whoever ran it checked, and chose not to remove it. Whether the original "three trait
categories" reasoning was re-evaluated for the new consumer, or simply carried forward unexamined
because the composition function was already there and worked, is not recorded either way.

## Decision

**`Persona.description_embedding` is computed from `display_name + long_description` (falling back
to `short_description`) only. `PersonaTrait[]` is never included in the embedded text, and no code
path recomputes or extends the embedding to cover traits.**

Concretely, `getPersonaDescriptionText` (`embedding-service.ts:104-111`) is the single, shared
composition function for this text, called from every write path that produces
`description_embedding` (`persona-corrections.ts:347-349,430-432` and
`persona-manager.ts:124-153`), and the resulting vector is consumed by exactly one read path today,
`retrievePersonasSemantic` (`retrieval.ts:321-340`), reached only through
`personas.ts execute()`'s tier-3 fallback (`personas.ts:31-34`).

## Alternatives Considered

### Alternative A: Embed the full trait text alongside the description

- **Description**: Concatenate trait `name`/`description` strings into the embedding input,
  giving semantic search a chance to match a query phrased in trait vocabulary (e.g. "who has
  zero-BS humor").
- **Pros**: Recovers matches for queries that describe a persona by behavior/personality rather
  than by whatever happens to be written in `long_description`.
- **Cons**: Directly reintroduces the diagnosed problem — `DEFAULT_SEED_TRAITS`
  (`seed-traits.ts:8-29`) are textually identical across every persona, so every persona's vector
  would share that substring, uniformly compressing inter-persona distance regardless of what
  actually makes them different; behavioral-constraint traits ("Avoid Financial/Technical
  Speculation...") would inject operating-rule text that a text embedder cannot distinguish from
  identity content.
- **Why not chosen**: No mitigation for the universal-seed-trait problem exists without a category
  discriminator (see Alternative C), and none exists on `PersonaTrait` today.

### Alternative B: Filter traits by `strength` before embedding

- **Description**: Only embed traits above some `strength` threshold, on the theory that
  high-strength traits are more "core" to identity.
- **Cons**: `strength` measures how strongly a trait applies, not what *kind* of trait it is.
  `DEFAULT_SEED_TRAITS` are seeded at `strength: 0.7` (`seed-traits.ts:12,23`) — comfortably above
  any plausible threshold — so a strength filter would keep exactly the universal noise it needs to
  exclude while potentially dropping a genuinely distinguishing but lower-strength identity trait.
- **Why not chosen**: `strength` and "is this identity, a behavioral rule, or a universal seed" are
  orthogonal axes; filtering on the wrong axis doesn't solve the stated problem.

### Alternative C: Add a `category` field to `PersonaTrait` and embed only identity-category traits

- **Description**: Extend `PersonaTrait` with an enum (`identity` / `behavioral` / `seed`) set at
  creation, and have `getPersonaDescriptionText` include only `identity`-category trait text.
- **Pros**: Would be the actual structural fix for the category-discrimination gap the recovered
  design notes name explicitly ("no programmatic way to distinguish these categories").
- **Cons**: Requires a schema addition, a classification step at every trait-creation call site
  (extraction, ceremony reflection, manual `ei update`), and a backfill decision for every
  already-persisted trait with no category — real scope for a benefit that's speculative absent a
  concrete query that `long_description`-only search is failing to serve.
- **Why not chosen**: Nothing in the current codebase (search complaints, failing test, open issue)
  demonstrates this gap is actually costing anything today; `long_description` already carries
  persona-authored identity prose, and the semantic tier is the last of three fallbacks, not the
  primary lookup path.

## Consequences

### Positive

- The embedding stays a clean, cheap proxy for "who is this persona, in their own words" —
  `display_name + long_description`, mirroring the same pattern `getPersonEmbeddingText`
  (`embedding-service.ts:61-63`) and `getTopicEmbeddingText`/`getItemEmbeddingText`
  (`embedding-service.ts:50-59`) already use elsewhere: compose from the entity's own descriptive
  prose fields, not its full structural payload.
- Because every persona shares the same seed traits verbatim (`seed-traits.ts:8-29`), excluding
  traits keeps the embedding's discriminating power concentrated on what's actually
  persona-specific instead of diluted by content identical across every persona.
- Recomputation is unconditional and cheap (local model, no network call — stated directly in the
  comment at `persona-corrections.ts:428-429`), so every write path can simply recompute rather
  than diff, with no correctness cost from staleness.

### Negative

- A query phrased purely in trait vocabulary (e.g. "who is aggressive and critical" for a persona
  whose `long_description` doesn't happen to echo that language) will not surface that persona
  through `retrievePersonasSemantic`, even though the trait exists verbatim on the record. The
  semantic tier only ever sees `display_name + long_description`.
- **`[INFERENCE]`** The rationale was tuned for a comparison target — `Person.description`, in the
  now-removed heartbeat drift check — that no longer exists. The current sole consumer,
  `retrievePersonasSemantic`, matches against an arbitrary free-text CLI/MCP query instead of
  another structured entity's embedding. The three-category noise problem (seed traits, behavioral
  rules) plausibly still degrades quality for this consumer too, since nothing about it is specific
  to the drift use case, but no evidence in the tracked history shows anyone re-verified that after
  the consumer changed.
- Until this ADR, the "why" was recorded nowhere a future maintainer could find without asking
  someone or re-deriving it — the type comment states the exclusion as a fact, the introducing
  commit message doesn't mention traits, and the actual reasoning lived only in local,
  non-versioned planning material. Anyone editing `getPersonaDescriptionText` to "just also include
  traits, more signal is better" would have had no signal they were repeating a previously-diagnosed
  mistake.

### Risks

- **The exclusion is enforced by convention, not by the type system.** `getPersonaDescriptionText`
  and `computePersonaDescriptionEmbedding` both take a bare `{ display_name, long_description?,
  short_description? }` shape (`embedding-service.ts:104-108,113-117`); nothing prevents a future
  call site from constructing a differently-composed object (e.g. one that pre-concatenates trait
  text into `long_description`) and getting the same "excludes traits" code path to embed trait
  content anyway. The boundary is "what today's three call sites happen to pass in," not something
  the compiler or a validator checks.
- **No category discriminator means the underlying problem can't be solved incrementally today.**
  If a future feature genuinely needs trait-aware persona search, it cannot cheaply filter to
  "identity traits only" — it must add a new field to `PersonaTrait` and classify every existing
  trait (Alternative C), or accept reintroducing the universal-seed-trait noise problem this
  decision was written to avoid.

## Reversibility

Moderate. Extending `getPersonaDescriptionText` to include trait text is a small, local code change
with no migration — `description_embedding` is already recomputed unconditionally on every write
(`persona-corrections.ts:428-432`, `persona-manager.ts:132-149`), so every persona's embedding would
self-heal to the new composition on its next update without any backfill script. The risk is not
reversibility of the *mechanism* — it's that reversing this decision without first solving the
category-discrimination gap (Alternative C) reintroduces the exact failure modes described above,
with no test in `tests/unit/cli/retrieval.test.ts` today that would catch the regression, since the
current `retrievePersonasSemantic` tests only exercise embedding presence/limit/threshold behavior,
not trait-noise quality.

## References

- `src/core/embedding-service.ts:104-125` — `getPersonaDescriptionText`,
  `computePersonaDescriptionEmbedding`
- `src/core/embedding-service.ts:50-63` — `getItemEmbeddingText`, `getTopicEmbeddingText`,
  `getPersonEmbeddingText`, the same-pattern siblings this decision mirrors
- `src/core/types/entities.ts:180` — `PersonaEntity.description_embedding` and its "Excludes
  traits" comment
- `src/core/types/data-items.ts:7-22,28-30,65-95` — `DataItemBase`, `PersonaTrait`, `Person`
- `src/core/constants/seed-traits.ts:1-29` — `DEFAULT_SEED_TRAITS` (`"Genuine Responses"`,
  `"Natural Speech"`), the concrete universal-seed-trait example
- `src/core/processor.ts:1114-1117,1137-1140` — seed-trait back-fill on hydration
- `src/core/personas/opencode-agent.ts:57-63` — seed-trait seeding at persona creation
- `src/cli/retrieval.ts:27,289-340` — `EMBEDDING_MIN_SIMILARITY`, `retrievePersonas`,
  `retrievePersonasSemantic`
- `src/cli/commands/personas.ts:6-35` — `execute()`, the three-tier fallback behind
  `ei personas <query>`
- `src/cli.ts:40-41,711-712` — CLI alias mapping and dynamic dispatch to `commands/personas.js`
- `src/cli/mcp.ts:98-140` — `ei_search` MCP tool, same dispatch for `type: "personas"`
- `src/cli/persona-corrections.ts:143-187,290-365,367-442` — `PERSONA_ROUND_TRIP_FIELDS`,
  `createPersonaEntity`, `updatePersonaEntity`
- `src/core/persona-manager.ts:124-153` — `updatePersona`, the internal-state-mutation write path
- `src/core/processor.ts:1324-1327,1329-1364` — `Processor.updatePersona`,
  `Processor.finalizeReflection` (the `/reflect apply` path)
- `src/core/handlers/human-matching.ts:259-260` — where `Person.embedding` is computed, the
  original drift-detection comparison target
- `tests/unit/cli/retrieval.test.ts:743-774` — `retrievePersonasSemantic` test coverage
- Commit `1384e044` (2026-04-06) — introduced `description_embedding` for heartbeat drift detection
- Commit `705e33c2` (2026-04-23) — removed the drift-detection consumer, replaced with
  `pending_update`
- Commit `a97703d0` (2026-04-27) — introduced `retrievePersonasSemantic`, the field's current
  consumer
- Commit `dac2786f` (2026-05-13) — narrowed the semantic tier to explicit persona lookup only
- Commit `928d8b93` (2026-07-09) — dead-field audit that removed `reflection_last_asked` and
  `last_extraction` but left `description_embedding` in place
- ADR-023 — a related but distinct decision about dropping the separate, deprecated *human*
  `Trait` entity type; that removal is unrelated to `PersonaTrait`, which remains live and
  unaffected
