# 0110: LLM Queue Persistence File

**Status**: PENDING

## Summary

Create a persistent queue file for LLM operations that survives application restarts. This ensures Ctrl+C doesn't lose pending extractions, validations, or other queued work.

## Design

### File Location

`data/llm_queue.jsonc`

### Queue Structure

```typescript
interface LLMQueueItem {
  id: string;                    // UUID
  type: QueueItemType;
  priority: "high" | "normal" | "low";
  created_at: string;            // ISO timestamp
  attempts: number;              // retry count
  last_attempt?: string;         // ISO timestamp
  
  // Type-specific payload
  payload: QueuePayload;
}

type QueueItemType = 
  | "fast_scan"           // Phase 1 extraction
  | "detail_update"       // Phase 2 extraction
  | "ei_validation"       // Pending Ei verification
  | "description_regen"   // Persona description update
  | "response";           // Conversation response (shouldn't queue, but safety net)

interface FastScanPayload {
  target: "human" | "system";
  persona: string;
  messages: Message[];           // The conversation chunk
}

interface DetailUpdatePayload {
  target: "human" | "system";
  persona: string;
  data_type: "fact" | "trait" | "topic" | "person";
  item_name: string;
  messages: Message[];
  is_new: boolean;               // New item vs update existing
}

interface EiValidationPayload {
  validation_type: "fact_confirm" | "cross_persona" | "conflict" | "staleness";
  item_name: string;
  data_type: "fact" | "trait" | "topic" | "person";
  context: string;               // Human-readable context for Ei to present
  source_persona?: string;       // Who triggered this (for cross_persona)
}

interface DescriptionRegenPayload {
  persona: string;
}

type QueuePayload = 
  | FastScanPayload 
  | DetailUpdatePayload 
  | EiValidationPayload
  | DescriptionRegenPayload;

interface LLMQueue {
  version: number;               // Schema version for future migrations
  items: LLMQueueItem[];
  last_processed?: string;       // ISO timestamp
}
```

### Queue Operations

```typescript
// Add item to queue
async function enqueueItem(item: Omit<LLMQueueItem, 'id' | 'created_at' | 'attempts'>): Promise<string>

// Get next item to process (respects priority)
async function dequeueItem(): Promise<LLMQueueItem | null>

// Mark item complete (removes from queue)
async function completeItem(id: string): Promise<void>

// Mark item failed (increments attempts, may re-prioritize)
async function failItem(id: string, error?: string): Promise<void>

// Get all pending validations (for Ei batching)
async function getPendingValidations(): Promise<LLMQueueItem[]>

// Clear completed validations after Ei processes them
async function clearValidations(ids: string[]): Promise<void>
```

### Queue Processing Rules

1. **Priority order**: high → normal → low
2. **Within priority**: FIFO (oldest first)
3. **Max attempts**: 3 (then move to dead letter or alert user)
4. **Ei validations**: Accumulate until Ei heartbeat, then batch

### Integration Points

- **ConceptQueue replacement**: This replaces the current in-memory ConceptQueue
- **Startup**: Load queue, resume processing
- **Shutdown**: Ensure queue is saved (should be automatic since we write on every change)

## Design Decisions (from Flare)

**Dead letter handling**: Log to debug file if debug mode, then drop. DLQ useful for debugging but shouldn't clutter queue.

```typescript
async function failItem(id: string, error?: string): Promise<void> {
  const queue = await loadQueue();
  const item = queue.items.find(i => i.id === id);
  
  if (!item) return;
  
  item.attempts++;
  item.last_attempt = new Date().toISOString();
  
  if (item.attempts >= 3) {
    // Dead letter - log if debug, then drop
    if (isDebugMode()) {
      appendDebugLog(`[DLQ] Dropping after 3 attempts: ${JSON.stringify(item)}`);
    }
    queue.items = queue.items.filter(i => i.id !== id);
  }
  
  await saveQueue(queue);
}
```

**Validation batching**: Daily Ceremony at configurable time (default 9am).
- Ei sends "Daily Confirmations" message
- Up to 5 pending validations per ceremony
- Some days it's empty - that's fine, establishes pattern
- User always knows when/why Ei is asking about data

## Acceptance Criteria

- [ ] LLMQueue interface defined
- [ ] Queue file created at data/llm_queue.jsonc
- [ ] enqueue/dequeue/complete/fail operations implemented
- [ ] Queue survives restart (manual test)
- [ ] Old ConceptQueue removed
- [ ] Queue processing integrated with existing flow

## Dependencies

- 0108: Entity type definitions (for Message type)

## Effort Estimate

Medium (~3-4 hours)
