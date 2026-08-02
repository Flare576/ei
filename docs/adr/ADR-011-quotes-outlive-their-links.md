# ADR-011: A Quote Outlives the Items It Was Linked To

## Status

Accepted

## Date

2026-08-02

## Context

A `Quote` is usually created in conjunction with a Topic, Person, or Fact — the extraction pipeline surfaces a memorable line while writing about something, and records what it was about in `data_item_ids`. That is the dominant path but not the only one: `Quote.created_by` admits `"human"` (`src/core/types/data-items.ts:77-91`), and the web capture modal creates quotes directly.

Those links are then actively pruned. Removing an entity filters its id out of **every** quote — `HumanState.fact_remove` (`src/core/state/human.ts:50-62`), and the same pattern in `topic_remove` and `person_remove`. **That cascade only ever subtracts**; it never re-adds what it removed.

Other paths do write links, so the list is not monotonically shrinking in general: dedup rewrites a removed id to its replacement rather than dropping it (`src/core/handlers/dedup.ts:109-123`), and `quote_update` can set `data_item_ids` wholesale (`src/core/state/human.ts:139-143`).

But nothing re-adds a link the cascade removed, so over a knowledge base's lifetime `data_item_ids` trends down and can reach zero. Nothing garbage-collects a quote in that state.

That looks at first like a leak — an entity slowly losing its handles until it is stranded. It is not. It is the intended behavior, and this record exists because the intent is invisible in the code: the removal cascade reads as cleanup, and nothing states that reaching zero is fine.

## Decision

**A Quote is an independent entity. It is never removed because the items it was linked to were removed. Zero links is a valid, permanent, non-exceptional state.**

The link records what a quote *was about at extraction time*. It does not define what the quote *is*, and it is not a reference count.

The owner's framing, which is the whole argument: *"'Oh My Stars!' is still fun to quote even if YoKaiWatch gets deleted."* The line's value was never a property of the topic that happened to surface it.

## Why this is safe: discovery does not depend on links

Verified rather than assumed, because the decision only holds if a zero-link quote is still findable.

`searchHumanData` searches `human.quotes` in full and gates candidacy solely on whether an item carries an embedding — `src/core/human-data-manager.ts:191` (`items.filter((i) => i.embedding?.length)`) and `:245` (`searchItems(human.quotes, (q) => q.text)`). `data_item_ids` is never consulted. Semantic search over a zero-link quote behaves identically to search over a fully-linked one.

## Consequences

### Positive

- A quote survives reorganisation of the knowledge base around it. Merging topics, splitting people, and deleting stale entities cost nothing in quotes.
- No reference counting, no cascade rules, no orphan collection. The absence of that machinery is the feature.

### Negative

- **`data_item_ids` is lossy.** It is not a durable record of a quote's original context — it is a live list of links that currently resolve. Anything wanting the original context needs another mechanism.
- **Zero-link quotes are invisible to the linked-item discovery paths.** `ei --id <topic>` returns nested `linked_quotes`; a quote with no links appears in no such listing. Semantic search is the main alternative — though recency and browse paths reach them too, without consulting embeddings at all (`ei quotes --recent` via `src/cli/retrieval.ts:57-62`, and the no-query branch at `src/core/human-data-manager.ts:187-189`).

### Risks

- **A quote with no embedding *and* no links is unreachable by semantic search.** `searchItems` filters to items carrying embeddings before any comparison, and the text-substring fallback at `:206-209` runs only when there is no query vector at all. Recency and browse paths still surface such a quote, so it is degraded rather than lost — but it will not answer the question that would naturally find it. Whether any embedding-less quote exists is unmeasured and worth a one-off census.
- **This matters most for source-orphaned quotes.** A census of the author's store on 2026-08-02 found 18 quotes with `message_id: null`, all `created_by: "extraction"`, clustered in a nine-day window in March 2026. Their source messages were destroyed by an early message-rolloff policy, so the quote is the only surviving trace. **That count is measured against a live private data file and is not reproducible from this repository** — treat it as an observation, not a verifiable fact. For those records, losing discoverability is permanent loss of something irreplaceable.

## Alternatives

### Alternative A: Delete a quote when its last link goes

Treat `data_item_ids` as a reference count.

**Why not chosen**: it makes a quote a property of its topic, which is backwards. The topic was the occasion for noticing the line, not the reason it matters. It would also make entity cleanup silently destructive — deleting a stale topic would take unrelated quotes with it, with no warning and no undo.

### Alternative B: Preserve links as historical record rather than pruning them

Keep removed ids so `data_item_ids` stays a faithful account of original context.

**Why not chosen**: it turns every link list into an accumulating set of dangling references that every consumer must then filter. The resolvers would need to tolerate ids that resolve to nothing, and "linked items" would stop meaning "items you can navigate to." The lossiness noted above is the accepted cost. Note the narrower claim: pruning keeps links resolving *along the managed paths*. It says nothing about records arriving through import, restore, or sync, which are outside this guarantee entirely.

## References

- `src/core/state/human.ts:50-62` — the removal cascade that prunes links
- `src/core/human-data-manager.ts:191,245` — discovery gates on embedding, never on links
- `docs/adr/ADR-010-invalid-persona-links-are-reported-not-repaired.md` — the neighbouring decision on what may modify a Quote
