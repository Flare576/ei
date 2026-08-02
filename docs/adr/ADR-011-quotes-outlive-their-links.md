# ADR-011: A Quote Outlives the Items It Was Linked To

## Status

Accepted

## Date

2026-08-02

## Context

A `Quote` is created in conjunction with a Topic, Person, or Fact — the extraction pipeline surfaces a memorable line while it is writing about something, and records what it was about in `data_item_ids`.

Those links are then actively pruned. Removing an entity filters its id out of **every** quote: `HumanState.fact_remove` (`src/core/state/human.ts:50-62`), and the same pattern in `topic_remove` and `person_remove`. Nothing re-adds them.

So a quote's `data_item_ids` shrinks monotonically over a knowledge base's lifetime, and can reach zero. Nothing garbage-collects a quote in that state.

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

- **`data_item_ids` is lossy and gets lossier.** It is not a durable record of a quote's original context — it is a live list of links that still resolve. Anything wanting the original context needs another mechanism.
- **Zero-link quotes are invisible to the linked-item discovery paths.** `ei --id <topic>` returns nested `linked_quotes`; a quote with no links appears in no such listing. Embedding search is its only surface.

### Risks

- **A quote with no embedding *and* no links is genuinely unreachable.** `searchItems` filters to items with embeddings before any semantic comparison, and the text-substring fallback at `:206-209` only runs when there is no query vector at all — so a quote missing an embedding is skipped in the normal path. Combined with zero links, nothing surfaces it. Whether any such quote exists is unverified and worth a one-off census.
- **This interacts badly with source-orphaned quotes.** 18 quotes in the author's own store have `message_id: null` — their source messages were destroyed by an early message-rolloff policy, so the quote is the only surviving trace (see `.sisyphus/issues/` and ADR-010's sibling discussion of the attested fix-flow, which refuses to modify them). For those, embedding search is not merely the primary discovery path, it is the last one. A missing embedding there is permanent, total loss of something irreplaceable.

## Alternatives

### Alternative A: Delete a quote when its last link goes

Treat `data_item_ids` as a reference count.

**Why not chosen**: it makes a quote a property of its topic, which is backwards. The topic was the occasion for noticing the line, not the reason it matters. It would also make entity cleanup silently destructive — deleting a stale topic would take unrelated quotes with it, with no warning and no undo.

### Alternative B: Preserve links as historical record rather than pruning them

Keep removed ids so `data_item_ids` stays a faithful account of original context.

**Why not chosen**: it turns every link list into an accumulating set of dangling references that every consumer must then filter. The resolvers would need to tolerate ids that resolve to nothing, and "linked items" would stop meaning "items you can navigate to." The lossiness noted above is the accepted cost of links that always resolve.

## References

- `src/core/state/human.ts:50-62` — the removal cascade that prunes links
- `src/core/human-data-manager.ts:191,245` — discovery gates on embedding, never on links
- `docs/adr/ADR-010-invalid-persona-links-are-reported-not-repaired.md` — the neighbouring decision on what may modify a Quote
