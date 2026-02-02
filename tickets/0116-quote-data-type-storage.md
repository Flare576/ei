# 0116: Quote Data Type & Storage

**Status**: DONE
**Epic**: E011 (Quote Preservation System)
**Depends on**: None

## Summary

Add the `Quote` data type to the core system and storage layer.

## Acceptance Criteria

- [ ] Add `Quote` interface to `src/core/types.ts`
- [ ] Add `quotes: Quote[]` to `HumanEntity` interface
- [ ] Add StateManager methods:
  - [ ] `addQuote(quote: Quote): void`
  - [ ] `updateQuote(id: string, updates: Partial<Quote>): void`
  - [ ] `deleteQuote(id: string): void`
  - [ ] `getQuotesForMessage(messageId: string): Quote[]`
  - [ ] `getQuotesForDataItem(dataItemId: string): Quote[]`
- [ ] Initialize `quotes: []` in default HumanEntity state
- [ ] Storage versioning: handle migration from states without `quotes`

## Quote Interface

```typescript
interface Quote {
  id: string;                    // UUID (use crypto.randomUUID())
  message_id: string;            // FK to Message.id
  data_item_ids: string[];       // FK[] to DataItemBase.id (topics, facts, etc.)
  persona_groups: string[];      // Visibility groups (inherit pattern from DataItemBase)
  
  text: string;                  // The quote content
  speaker: "human" | string;     // Who said it (persona name or "human")
  timestamp: string;             // ISO timestamp (from original message)
  
  start: number | null;          // Character offset in message (null = can't highlight)
  end: number | null;            // Character offset in message (null = can't highlight)
  
  created_at: string;            // ISO timestamp when captured
  created_by: "extraction" | "human";  // How it was created
}
```

## Notes

**Referential Constraint**: `data_item_ids` references IDs from Facts, Traits, Topics, or People. This is EI's first cross-entity reference. For now, we don't enforce FK integrity (if a Topic is deleted, orphaned quotes remain). Future ticket could add cleanup.

**Why not on DataItemBase?**: Quotes span contexts. A single quote might relate to multiple topics, or be meaningful on its own. Storing them separately allows:
- Survival during Topic compaction
- Association with multiple data items
- Global browsing/search

## Testing

- [ ] Unit test: CRUD operations on quotes
- [ ] Unit test: Query quotes by message ID
- [ ] Unit test: Query quotes by data item ID
- [ ] Unit test: Storage migration handles missing `quotes` field
