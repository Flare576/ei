# 0147: Smart Embedding Recalculation on Human Data Updates

**Status**: DONE
**Depends on**: None
**Blocked by**: None

---

## Summary

Currently, `Processor.updateHuman()` does a simple spread merge:
```typescript
const current = this.stateManager.getHuman();
this.stateManager.setHuman({ ...current, ...updates });
```

This works but has a problem: when frontends (web, TUI) edit human data items (facts, traits, topics, people, quotes), the embeddings returned to them are stripped (as of 0142 QA). When they send updates back, the items have no embeddings, so the spread merge overwrites existing embeddings with `undefined`.

The current workaround: spread merge happens to preserve embeddings because `{ ...current, ...updates }` keeps current's nested arrays if updates doesn't include them. BUT if updates DOES include a data array (e.g., `facts`), those facts won't have embeddings.

We need `updateHuman` to be smarter about detecting what actually changed and recalculating embeddings only when text content changes.

## Acceptance Criteria

- [x] Create helper function to diff incoming data items against existing
- [x] Detect which items changed (by id)
- [x] Detect which fields of those items changed
- [x] Determine if changed fields impact embeddings (name, description for DataItems; text for Quotes)
- [x] Recalculate embeddings only for items with text content changes
- [x] Skip items that haven't changed at all
- [x] Preserve existing embeddings for items with only non-text changes (sentiment, strength, exposure_*, etc.)
- [ ] Unit tests for the diff/recalculation logic

## Implementation Notes

### Helper Functions Added (src/core/embedding-service.ts)

```typescript
// Detect if data item text content changed
needsEmbeddingUpdate(existing, incoming): boolean

// Detect if quote text changed  
needsQuoteEmbeddingUpdate(existing, incoming): boolean

// Compute embedding for data items (name + description)
computeDataItemEmbedding(item): Promise<number[] | undefined>

// Compute embedding for quotes (text only)
computeQuoteEmbedding(text): Promise<number[] | undefined>
```

### Updated Processor Methods

- `upsertFact()`, `upsertTrait()`, `upsertTopic()`, `upsertPerson()` - Now check if text content changed before computing embeddings, preserve existing embeddings for non-text changes
- `addQuote()` - Computes embedding if not already present
- `updateQuote()` - Recomputes embedding only when `text` field changes

### Fields that affect embeddings

**DataItems (Fact, Trait, Topic, Person):**
- `name` - YES, affects embedding
- `description` - YES, affects embedding
- All other fields (sentiment, strength, exposure_*, validated, relationship, etc.) - NO

**Quotes:**
- `text` - YES, affects embedding
- All other fields (speaker, data_item_ids, persona_groups, etc.) - NO
