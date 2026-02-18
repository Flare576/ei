# 0135: Per-Message Extraction Tracking

**Status**: DONE
**Depends on**: None
**Blocked by**: None

## Summary

Replace global `last_seeded_*` timestamps on HumanEntity with per-message extraction flags. This enables multi-machine synchronization where any device can write messages and any device can run extraction without duplicate processing or race conditions.

## Problem

The current approach uses global timestamps on HumanEntity:
```typescript
last_seeded_fact?: string    // ISO timestamp
last_seeded_trait?: string
last_seeded_topic?: string
last_seeded_person?: string
```

This breaks with multi-machine sync:
1. Machine1 writes Message1 at T1, syncs to cloud
2. Machine2 imports, writes Message2 at T2
3. Machine2 runs extraction - which `last_seeded_*` value wins?
4. If Machine2's timestamps were empty, it re-processes Message1
5. If Machine2's timestamps were from Machine1, it might skip Message2

**Root cause**: Global timestamps assume a single writer. Messages can come from anywhere (direct chat, OpenCode imports, future integrations).

## Solution

Add extraction completion flags directly to each Message:

```typescript
interface Message {
  // ... existing fields
  f?: boolean;  // Fact extraction completed
  r?: boolean;  // tRait extraction completed  
  p?: boolean;  // Person extraction completed
  o?: boolean;  // tOpic extraction completed
}
```

**Why single-letter names**: With ~15k messages (from OpenCode imports), minimizing field name overhead matters. Using "omit when false" pattern, most messages add zero bytes.

**Extraction flow becomes**:
1. Query messages where `p !== true` (example: person extraction)
2. Process those messages
3. Mark `p = true` on each processed message
4. Sync happens naturally - each message carries its own state

## Acceptance Criteria

### Phase 1: Type Updates
- [x] Add optional extraction flags to `Message` interface in types.ts:
  ```typescript
  f?: boolean;  // Fact extraction completed
  r?: boolean;  // tRait extraction completed
  p?: boolean;  // Person extraction completed
  o?: boolean;  // tOpic extraction completed
  ```
- [x] Update CONTRACTS.md with new Message schema
- [x] Remove `last_seeded_*` fields from HumanEntity (not live yet, no deprecation needed)

### Phase 2: StateManager Updates
- [x] Add `messages_markExtracted(personaId: string, messageIds: string[], flag: 'f'|'r'|'p'|'o')` method
- [x] Add `messages_getUnextracted(personaId: string, flag: 'f'|'r'|'p'|'o', limit?: number)` method

### Phase 3: Extraction Logic Updates
- [x] Update `human-extraction.ts` orchestrator to:
  - Pass `extraction_flag` in ExtractionContext
  - Pass `message_ids_to_mark` in request data
- [x] Update handlers to mark messages as extracted after processing:
  - `handleHumanFactScan` marks messages with `f` flag
  - `handleHumanTraitScan` marks messages with `r` flag
  - `handleHumanTopicScan` marks messages with `p` flag
  - `handleHumanPersonScan` marks messages with `o` flag
- [x] Update `processor.ts` `checkAndQueueHumanExtraction`:
  - Use `messages_getUnextracted()` instead of timestamp-based splitting
  - Remove all `last_seeded_*` timestamp logic
- [x] Update `ceremony.ts` `queueExposurePhase`:
  - Use flag-based queries for each extraction type
  - Remove `last_ceremony` timestamp-based filtering

### Phase 4: Tests
- [x] Update tests that referenced `last_seeded_*` fields
- [x] All tests passing

## Size Analysis

With "omit when false" pattern:
- Unprocessed messages: 0 bytes added
- Fully processed messages: ~44 bytes (`"f":true,"r":true,"p":true,"o":true`)
- Typical case (most messages unprocessed): Negligible impact

Worst case (15k messages, all processed): ~660KB total - acceptable.

## Migration Notes

**No data migration needed**: Old messages without flags are treated as unprocessed (flags undefined = needs extraction). This is actually the correct behavior - if we don't know whether a message was extracted, we should process it.

**Backward compatibility**: Old saves load fine. New extraction logic simply processes all messages without flags.

## Relation to Other Tickets

- **0129 (Settings Menu Redesign)**: Independent - this doesn't change settings location
- **0146 (Write-Through Storage)**: Independent - this doesn't change storage mechanism  
- **Local vs Global Settings** (future): This ticket removes one source of sync conflicts. Further local/global settings split is a separate concern.

## Notes

Original ticket was about migrating `last_seeded_*` and `ceremony_config` to `settings.*` namespace. That approach doesn't solve the multi-machine sync problem. This redesign addresses the root cause.

**ceremony_config migration**: Deferred to a separate ticket if still needed. The namespace location is orthogonal to the sync problem this ticket solves.

## Implementation Summary

**Files Modified:**
- `src/core/types.ts` - Added f/r/p/o flags to Message, removed last_seeded_* from HumanEntity
- `src/core/state/personas.ts` - Added messages_getUnextracted, messages_markExtracted
- `src/core/state-manager.ts` - Added passthrough methods
- `src/core/orchestrators/human-extraction.ts` - Added extraction_flag and message_ids_to_mark to context/requests
- `src/core/handlers/index.ts` - Added markMessagesExtracted helper, updated all scan handlers
- `src/core/processor.ts` - Rewrote checkAndQueueHumanExtraction to use flag-based queries
- `src/core/orchestrators/ceremony.ts` - Updated queueExposurePhase to use flag-based queries
- `CONTRACTS.md` - Updated Message interface documentation
- Tests updated to match new behavior
