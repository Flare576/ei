# 0127: Queue Message Fetch Refactor

**Status**: DONE
**Depends on**: None
**Priority**: Medium

## Summary

Refactor the LLM request queue to store message references (personaName + timestamp) instead of full message objects. Messages are fetched just-in-time when the request is processed, rather than at queue-time.

This addresses:
1. **localStorage quota issues** - Full message arrays in queue cause quota exceeded errors when many requests are queued (e.g., during Ceremony)
2. **Mobile RAM concerns** - Storing duplicate message data is wasteful
3. **Stale data** - Current approach sends old messages even if user edits/deletes them before processing

## Problem Analysis

Current flow:
- `sendMessage()` queues a response request with `messages: ChatMessage[]` (full conversation)
- Extraction orchestrators store `data.messages_context` and `data.messages_analyze` (full message objects)
- Queue stores 80+ requests during Ceremony, each with duplicate message data
- localStorage quota exceeded → auto-save fails → work loop crashes

## Proposed Solution

### For Response Requests

**Before:**
```typescript
stateManager.queue_enqueue({
  type: LLMRequestType.Response,
  messages: chatMessages, // Full conversation array
  data: { personaName },
});
```

**After:**
```typescript
stateManager.queue_enqueue({
  type: LLMRequestType.Response,
  // No messages field
  data: { 
    personaName,
    context_cutoff?: string, // Optional: force context from this timestamp
  },
});
```

At processing time, `QueueProcessor` or `Processor` fetches messages from `StateManager`.

### For Extraction Requests

**Before:**
```typescript
stateManager.queue_enqueue({
  next_step: LLMNextStep.HandleHumanFactScan,
  data: {
    personaName,
    messages_context: [...], // Full message array
    messages_analyze: [...], // Full message array
  },
});
```

**After:**
```typescript
stateManager.queue_enqueue({
  next_step: LLMNextStep.HandleHumanFactScan,
  data: {
    personaName,
    analyze_from_timestamp: string, // Boundary between context and analyze
  },
});
```

At processing time:
```typescript
const messages = stateManager.messages_get(personaName);
const splitIndex = messages.findIndex(m => new Date(m.timestamp).getTime() >= analyzeFrom);
const context = messages.slice(0, splitIndex);
const analyze = messages.slice(splitIndex);
```

## Acceptance Criteria

- [x] Remove `messages?: ChatMessage[]` from `LLMRequest` type
- [x] Update `Processor.sendMessage()` to not store messages in queue
- [x] Update `QueueProcessor.processRequest()` to fetch messages before LLM call
- [x] Update all extraction orchestrators to store timestamps, not messages
- [x] Update extraction handlers if they rely on `request.data.messages_*`
- [x] Verify queue storage is significantly smaller
- [x] Verify behavior is unchanged (responses work, extractions work)
- [x] Add unit test verifying message fetch at execution time

## Edge Cases to Verify

1. **User sends messages while response is queued** - Already handled by `clearPendingRequestsFor()`
2. **User deletes messages** - New behavior: deleted messages won't be sent (better UX)
3. **User edits messages** - New behavior: edited version sent (better UX)
4. **Context boundary changes** - New behavior: fresh boundary respected (better UX)

## Files to Modify

- `src/core/types.ts` - Update `LLMRequest` interface
- `src/core/processor.ts` - Update `sendMessage()`
- `src/core/queue-processor.ts` - Add message fetching logic
- `src/core/orchestrators/human-extraction.ts` - All `queue*Scan` functions
- `src/core/orchestrators/ceremony.ts` - Any direct queueing
- `src/core/handlers/*.ts` - If any rely on `data.messages_*`
- `tests/unit/core/queue-processor.test.ts` - Update tests

## Notes

This change is architecturally cleaner and solves multiple problems:
- Storage efficiency (smaller queue in localStorage)
- Memory efficiency (no duplicate data in RAM)
- Data freshness (always uses current state)

The immediate workaround (quota error handling + queue clear button) was implemented in 0096 QA to unblock testing.
