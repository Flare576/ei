# 0062: Add concept_processed Flag to Messages

**Status**: DONE

## Summary
Add a `concept_processed` boolean field to the Message interface to track which messages have been incorporated into concept map updates. This enables the asynchronous concept processing system to know which messages still need analysis.

## Problem
Currently, concept updates happen inline with message processing - there's no need to track "processed" state. With the new async architecture (0061), we need to:
1. Know which messages haven't been processed for concepts yet
2. Batch unprocessed messages when triggering concept updates
3. Mark messages as processed once the concept queue handles them

## Proposed Solution

### 1. Update Message Interface (types.ts)
```typescript
export interface Message {
  role: "human" | "system";
  content: string;
  timestamp: string;
  state?: MessageState;
  read?: boolean;
  concept_processed?: boolean; // NEW - undefined/false = not processed
}
```

### 2. Add Storage Helper Functions (storage.ts)
```typescript
export async function getUnprocessedMessages(
  persona?: string,
  beforeTimestamp?: number
): Promise<Message[]> {
  const history = await loadHistory(persona);
  return history.messages.filter(m => 
    !m.concept_processed && 
    (!beforeTimestamp || new Date(m.timestamp).getTime() < beforeTimestamp)
  );
}

export async function markMessagesConceptProcessed(
  messageTimestamps: string[],
  persona?: string
): Promise<void> {
  const history = await loadHistory(persona);
  let changed = false;
  for (const msg of history.messages) {
    if (messageTimestamps.includes(msg.timestamp) && !msg.concept_processed) {
      msg.concept_processed = true;
      changed = true;
    }
  }
  if (changed) {
    await saveHistory(history, persona);
  }
}
```

### 3. Migration Strategy
- Existing messages without the field are treated as `concept_processed: true` (backward compatible)
- New messages default to `concept_processed: false` when created via appendMessage/appendHumanMessage
- No data migration needed - field is optional

## Acceptance Criteria
- [x] Message interface updated with optional `concept_processed` field
- [x] `appendMessage()` sets `concept_processed: false` by default
- [x] `appendHumanMessage()` sets `concept_processed: false` by default
- [x] `getUnprocessedMessages()` helper function implemented
- [x] `markMessagesConceptProcessed()` helper function implemented
- [x] Optional `beforeTimestamp` filter for stale message detection
- [x] Existing history files load correctly (backward compatible)
- [x] Unit tests for new storage functions
- [x] TypeScript compilation passes

## Value Statement
**Foundation for Async Processing**: This field is the key data point that enables decoupling concept updates from conversation. Without it, we can't track what needs processing.

## Dependencies
- Part of 0061: Concept Processing Architecture Overhaul

## Effort Estimate
Small (~1 hour)
- Type update: 10 minutes
- Storage functions: 30 minutes
- Tests: 20 minutes

## Technical Notes
- Using optional field with undefined = false semantics for backward compatibility
- Timestamps as identifiers work because they're ISO strings with millisecond precision
- Consider adding index if performance becomes an issue with large histories
