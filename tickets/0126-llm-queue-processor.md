# 0126: LLM Queue Processor

**Status**: QA

## Summary

Implement a background queue processor that executes items from the persistent LLM queue. This is the infrastructure that connects queue persistence (0110) with the extraction/validation work (0112, 0113, 0115).

## Design

### Architecture

Standalone background service that:
1. Continuously pulls items from the persistent queue
2. Executes them via LLM calls
3. Respects provider concurrency limits
4. Can be interrupted by high-priority user messages
5. Integrates with existing `AbortController` pattern

### Queue Processor Class

```typescript
/**
 * Background processor for the persistent LLM queue.
 * Handles execution of queued extraction, validation, and description tasks.
 */
class QueueProcessor {
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private abortController: AbortController | null = null;
  private processingPromise: Promise<void> | null = null;
  
  /**
   * Start the queue processor.
   * Begins continuous processing of queued items.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.isPaused = false;
    this.processingPromise = this.processLoop();
    
    appendDebugLog("[QueueProcessor] Started");
  }
  
  /**
   * Stop the queue processor.
   * Aborts current work and stops processing.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.abortCurrent();
    
    if (this.processingPromise) {
      await this.processingPromise;
    }
    
    appendDebugLog("[QueueProcessor] Stopped");
  }
  
  /**
   * Pause queue processing (e.g., when user sends message).
   * Aborts current work but remains ready to resume.
   */
  pause(): void {
    if (!this.isRunning) return;
    
    this.isPaused = true;
    this.abortCurrent();
    
    appendDebugLog("[QueueProcessor] Paused");
  }
  
  /**
   * Resume queue processing after pause.
   */
  resume(): void {
    if (!this.isRunning) return;
    
    this.isPaused = false;
    
    appendDebugLog("[QueueProcessor] Resumed");
  }
  
  /**
   * Main processing loop.
   * Continuously processes queue items until stopped.
   */
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      if (this.isPaused) {
        // Wait before checking again
        await sleep(100);
        continue;
      }
      
      const processed = await this.processNext();
      
      if (!processed) {
        // Queue empty, wait before checking again
        await sleep(1000);
      }
    }
  }
  
  /**
   * Process the next item from the queue.
   * Returns true if an item was processed, false if queue was empty.
   */
  private async processNext(): Promise<boolean> {
    const item = await dequeueItem();
    
    if (!item) {
      return false;
    }
    
    this.abortController = new AbortController();
    
    try {
      await this.executeItem(item);
      await completeItem(item.id);
      return true;
    } catch (err) {
      if (err instanceof LLMAbortedError) {
        // Aborted by pause/stop - don't count as failure
        appendDebugLog(`[QueueProcessor] Item ${item.id} aborted (paused or stopped)`);
      } else {
        // Real failure - increment retry count
        await failItem(item.id, err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      this.abortController = null;
    }
  }
  
  /**
   * Execute a specific queue item based on its type.
   */
  private async executeItem(item: LLMQueueItem): Promise<void> {
    switch (item.type) {
      case "fast_scan":
        await this.executeFastScan(item.payload as FastScanPayload);
        break;
      case "detail_update":
        await this.executeDetailUpdate(item.payload as DetailUpdatePayload);
        break;
      case "ei_validation":
        // Ei validations are batched in Daily Ceremony, not processed here
        appendDebugLog(`[QueueProcessor] Skipping ei_validation (handled by Daily Ceremony)`);
        break;
      case "description_regen":
        await this.executeDescriptionRegen(item.payload as DescriptionRegenPayload);
        break;
      case "response":
        // Responses should never be queued (they're synchronous)
        appendDebugLog(`[QueueProcessor] WARNING: response item in queue (should be synchronous)`);
        break;
    }
  }
  
  private async executeFastScan(payload: FastScanPayload): Promise<void> {
    const { target, persona, messages } = payload;
    
    const result = await runFastScan(
      target,
      persona,
      messages,
      this.abortController?.signal
    );
    
    if (result) {
      await routeFastScanResults(result, target, persona, messages);
    }
  }
  
  private async executeDetailUpdate(payload: DetailUpdatePayload): Promise<void> {
    // Implementation will come in ticket 0112
    // For now, just log
    appendDebugLog(`[QueueProcessor] Detail update queued: ${payload.item_name}`);
  }
  
  private async executeDescriptionRegen(payload: DescriptionRegenPayload): Promise<void> {
    // Implementation will come in ticket 0112
    // For now, just log
    appendDebugLog(`[QueueProcessor] Description regen queued: ${payload.persona}`);
  }
  
  private abortCurrent(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
```

### Provider-Aware Concurrency

**Requirement**: Local providers (LM Studio) have limited concurrency, cloud providers can handle multiple concurrent requests.

**Implementation Strategy**:
- **Phase 1 (this ticket)**: Sequential processing (max 1 concurrent)
- **Phase 2 (future optimization)**: Provider-aware parallel processing

**Rationale**: 
- Sequential is simpler and works for all providers
- Queue items are already small (single-item detail updates)
- Can add parallelism later without changing the public API
- Ticket 0112 mentions parallelism, but that's for *batches of detail updates*, not queue processing itself

```typescript
// Future enhancement (not in this ticket):
async function processBatch(items: LLMQueueItem[]): Promise<void> {
  const provider = getCurrentProvider();
  const maxConcurrent = provider === "local" ? 1 : 3;
  
  const batches = chunk(items, maxConcurrent);
  for (const batch of batches) {
    await Promise.all(batch.map(item => executeItem(item)));
  }
}
```

### Integration with Blessed App

**Lifecycle**:
1. **Startup** (`blessed/app.ts` constructor): Create and start processor
2. **User sends message**: Pause processor, handle conversation, resume processor
3. **Shutdown** (Ctrl+C, /exit): Stop processor gracefully

```typescript
// blessed/app.ts modifications

import { QueueProcessor } from "../queue-processor.js";

class EIApp {
  private queueProcessor: QueueProcessor;
  
  constructor() {
    // ... existing setup ...
    
    // Start queue processor
    this.queueProcessor = new QueueProcessor();
    this.queueProcessor.start();
  }
  
  private async processPersonaQueue(personaName: string) {
    // Pause background extraction while handling conversation
    this.queueProcessor.pause();
    
    try {
      // ... existing conversation processing ...
    } finally {
      // Resume background extraction
      this.queueProcessor.resume();
    }
  }
  
  async shutdown() {
    await this.queueProcessor.stop();
    // ... existing shutdown ...
  }
}
```

### Error Handling

**Retry Logic**: Already handled by `llm-queue.ts`:
- Max 3 attempts per item
- After 3 failures → dead letter (logged and dropped)

**Abort Handling**:
- Pause/stop → abort current LLM call
- Aborted items stay in queue (attempts not incremented)
- Next iteration picks up where it left off

**Failure Categories**:
1. **Aborted** (pause/stop): Don't increment attempts, item stays in queue
2. **LLM error** (rate limit, network): Increment attempts, retry
3. **Validation error**: Increment attempts, may need Ei validation

## Acceptance Criteria

- [x] `QueueProcessor` class implemented in `src/queue-processor.ts`
- [x] `start()` begins continuous processing
- [x] `stop()` gracefully shuts down (aborts current, waits for completion)
- [x] `pause()` aborts current work without stopping processor
- [x] `resume()` continues processing after pause
- [x] `executeFastScan()` calls `runFastScan()` and routes results
- [x] `executeDetailUpdate()` placeholder (implemented in 0112)
- [x] `executeDescriptionRegen()` placeholder (implemented in 0112)
- [x] `ei_validation` items skipped (handled by Daily Ceremony in 0115)
- [x] Integrated with `blessed/app.ts` lifecycle
- [x] User messages pause queue processing
- [x] Tests cover start/stop/pause/resume lifecycle
- [x] Tests verify abort signal propagation
- [x] Tests verify retry logic (successful and failed items)

## Dependencies

- 0108: Entity type definitions
- 0109: Storage migration
- 0110: LLM queue persistence
- 0111: Fast-scan extraction

## Blocked By This Ticket

- 0112: Detail Update Prompts (needs processor to execute detail updates)
- 0113: Extraction Frequency Controller (needs processor to execute fast-scans)

## Effort Estimate

Medium (~3-4 hours)

## Implementation Notes

### Testing Strategy

**Unit Tests**:
- Lifecycle: start, stop, pause, resume
- Queue empty state (should wait)
- Queue with items (should process)
- Abort during processing (should not fail item)
- LLM error during processing (should fail item)

**Integration Tests**:
- Process fast_scan item end-to-end
- Verify detail_update items are queued (don't execute yet)
- Verify blessed app integration (pause on user message)

### Future Enhancements (NOT in this ticket)

1. **Parallel processing**: Process up to N items concurrently (provider-aware)
2. **Priority scheduling**: High priority items processed first
3. **Metrics**: Track queue depth, processing time, success/failure rates
4. **Health monitoring**: Alert if queue depth grows unbounded
