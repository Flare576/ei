# 0130: Fix ei_validation Queue Dequeue Bug

**Status**: PENDING

## Summary

`ei_validation` items are being dequeued and completed by the regular queue processor instead of being left in the queue for Daily Ceremony. This causes cross-persona validations and low-confidence extractions to vanish before Ei can verify them.

## Bug Details

### What Should Happen

1. Extraction system queues `ei_validation` items for:
   - Low-confidence extractions (facts/traits/topics/people)
   - Cross-persona updates to global data
2. These items **stay in queue** until Daily Ceremony
3. Daily Ceremony at 9am:
   - Calls `getPendingValidations()` to get `ei_validation` items
   - Builds ceremony message with up to 5 items
   - After user responds, calls `clearValidations()` to remove processed items

### What Actually Happens

1. Extraction queues `ei_validation` items correctly ✅
2. Queue processor dequeues them ❌
3. Queue processor hits `case "ei_validation"`, logs "skipping" ❌
4. Queue processor calls `completeItem()`, removing them from queue ❌
5. Daily Ceremony calls `getPendingValidations()` → returns empty array ❌

### Evidence

From debug log:
```
[2026-01-21T23:11:26.259Z] [CrossPersona] Queued validation for "woodworking process" (updated by Imposter)
[2026-01-21T23:11:26.260Z] [LLMQueue] Enqueued ei_validation (priority: normal, id: ..., queue length: 1)
[later...]
[2026-01-21T23:11:27.123Z] [LLMQueue] Dequeued ei_validation (priority: normal, id: ..., attempts: 0)
[2026-01-21T23:11:27.124Z] [QueueProcessor] Skipping ei_validation (handled by Daily Ceremony)
[2026-01-21T23:11:27.125Z] [LLMQueue] Completed item ...
```

The item is dequeued, "skipped", then completed (removed from queue).

## Root Cause

**File**: `src/queue-processor.ts`  
**Lines**: 140, 149, 175-178, 150

```typescript
private async processNext(): Promise<boolean> {
  const item = await dequeueItem();  // Line 140 - removes from queue
  
  if (!item) return false;
  
  this.abortController = new AbortController();
  
  try {
    await this.executeItem(item);  // Line 149
    await completeItem(item.id);   // Line 150 - marks complete
    return true;
  } catch (err) {
    // ...
  }
}

private async executeItem(item: LLMQueueItem): Promise<void> {
  switch (item.type) {
    // ...
    case "ei_validation":
      // Line 175-178
      appendDebugLog(`[QueueProcessor] Skipping ei_validation (handled by Daily Ceremony)`);
      break;  // Does nothing, but item already dequeued!
    // ...
  }
}
```

The problem: `dequeueItem()` returns the item but doesn't remove it from the queue. But then `completeItem()` is always called after `executeItem()`, which **does** remove it.

## Solution Options

### Option A: Filter in `dequeueItem()`

Make `dequeueItem()` skip `ei_validation` items entirely:

```typescript
// src/llm-queue.ts
export async function dequeueItem(): Promise<LLMQueueItem | null> {
  const queue = await loadQueue();
  
  if (queue.items.length === 0) {
    return null;
  }
  
  // Sort by priority (high first), then by created_at (oldest first)
  queue.items.sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    if (a.priority !== b.priority) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return a.created_at.localeCompare(b.created_at);
  });
  
  // Skip ei_validation items - they're batched in Daily Ceremony
  const item = queue.items.find(i => i.type !== "ei_validation");
  
  if (!item) {
    appendDebugLog('[LLMQueue] Queue has only ei_validation items (waiting for Daily Ceremony)');
    return null;
  }
  
  appendDebugLog(
    `[LLMQueue] Dequeued ${item.type} (priority: ${item.priority}, id: ${item.id}, attempts: ${item.attempts})`
  );
  
  return item;
}
```

**Pros**: Clean, simple, single point of control  
**Cons**: None really

### Option B: Don't Call `completeItem()` for Skipped Items

Track whether item was actually processed:

```typescript
// src/queue-processor.ts
private async executeItem(item: LLMQueueItem): Promise<boolean> {
  switch (item.type) {
    case "fast_scan":
      await this.executeFastScan(item.payload as FastScanPayload);
      return true;  // Processed
    case "ei_validation":
      appendDebugLog(`[QueueProcessor] Skipping ei_validation (handled by Daily Ceremony)`);
      return false;  // Not processed
    // ...
  }
}

private async processNext(): Promise<boolean> {
  const item = await dequeueItem();
  if (!item) return false;
  
  this.abortController = new AbortController();
  
  try {
    const processed = await this.executeItem(item);
    if (processed) {
      await completeItem(item.id);
    }
    return true;
  } catch (err) {
    // ...
  }
}
```

**Pros**: More explicit control  
**Cons**: More complex, easy to forget to return correct boolean

### Option C: Remove Case from Queue Processor

Just delete the `ei_validation` case entirely and let `dequeueItem()` handle filtering:

```typescript
// Remove this entirely from queue-processor.ts:
case "ei_validation":
  appendDebugLog(`[QueueProcessor] Skipping ei_validation (handled by Daily Ceremony)`);
  break;
```

**Pros**: Simplest code change  
**Cons**: Less explicit about what's happening

## Recommended Solution

**Option A** - Filter in `dequeueItem()`. It's the single source of truth for "what should the queue processor work on?"

## Acceptance Criteria

- [ ] Cross-persona validations stay in queue after being enqueued
- [ ] `getPendingValidations()` returns queued `ei_validation` items
- [ ] Daily Ceremony can retrieve and display validations
- [ ] Queue processor logs when it skips queue entirely due to only `ei_validation` items
- [ ] After Daily Ceremony processes validations, they are cleared from queue
- [ ] Debug log shows clear flow: enqueue → wait → ceremony retrieves → user responds → cleared

## Test Scenario

1. Create persona Alice (non-omniscient)
2. Tell Alice something about yourself: "I love woodworking"
3. Check debug log: should see `[CrossPersona] Queued validation for "woodworking"`
4. Wait 1 minute (let queue processor cycle)
5. Check queue: `ei_validation` item should still be there
6. Check Ei's next Daily Ceremony message: should include "woodworking" validation

## Dependencies

- Part of 0107 epic (blocking completion)
- Relates to 0116 (Cross-Persona Validation)
- Relates to 0115 (Daily Ceremony)

## Effort Estimate

Small (~30 minutes) - Simple filter logic change

## Notes

This is a regression/incomplete implementation - the design was always for `ei_validation` items to stay queued until Daily Ceremony, but the queue processor implementation didn't account for "items that should never be dequeued by the regular processor."
