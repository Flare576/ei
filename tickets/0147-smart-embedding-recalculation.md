# 0147: Smart Embedding Recalculation on Human Data Updates

**Status**: PENDING
**Depends on**: None
**Blocked by**: None

---

## ⚠️ DRAFT - NEEDS HUMAN + AI REVIEW ⚠️

This ticket was drafted during QA of 0142 (TUI $EDITOR integration) while deep in the weeds.
It needs fleshing out by someone with fresh context before implementation.

Key questions to resolve:
- Is the helper function approach the right abstraction?
- Should this be a separate function or inline in updateHuman?
- What about the individual upsert methods (upsertFact, etc.) - should they also use this logic?
- Performance implications of diffing large data sets?

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

- [ ] Create helper function to diff incoming data items against existing
- [ ] Detect which items changed (by id)
- [ ] Detect which fields of those items changed
- [ ] Determine if changed fields impact embeddings (name, description for DataItems; text for Quotes)
- [ ] Recalculate embeddings only for items with text content changes
- [ ] Skip items that haven't changed at all
- [ ] Preserve existing embeddings for items with only non-text changes (sentiment, strength, exposure_*, etc.)
- [ ] Unit tests for the diff/recalculation logic

## Notes

### Fields that affect embeddings

**DataItems (Fact, Trait, Topic, Person):**
- `name` - YES, affects embedding
- `description` - YES, affects embedding
- All other fields (sentiment, strength, exposure_*, validated, relationship, etc.) - NO

**Quotes:**
- `text` - YES, affects embedding
- All other fields (speaker, data_item_ids, persona_groups, etc.) - NO

### Embedding generation reference

```typescript
// From src/core/embedding-service.ts
export function getItemEmbeddingText(item: { name: string; description?: string }): string {
  if (item.description) {
    return `${item.name}: ${item.description}`;
  }
  return item.name;
}
```

### Individual upsert methods

The Processor also has `upsertFact()`, `upsertTrait()`, `upsertTopic()`, `upsertPerson()` which the TUI currently uses. These pass items directly to StateManager without any embedding handling.

Decision needed: Should these methods also do smart embedding recalculation? Or should we deprecate them in favor of `updateHuman()`?

### Related code locations

- `src/core/processor.ts` - updateHuman(), upsert* methods
- `src/core/state-manager.ts` - human_*_upsert() methods  
- `src/core/state/human.ts` - actual upsert implementations (full object replacement)
- `src/core/embedding-service.ts` - getItemEmbeddingText(), getEmbeddingService().embed()
- `tui/src/commands/me.tsx` - current usage of upsert methods
