# 0064: Implement ConceptQueue Background Processor

**Status**: DONE

## Summary
Create a singleton ConceptQueue class that manages asynchronous concept map updates. This is the core infrastructure for decoupling concept processing from the conversational loop.

## Problem
Currently, concept updates are synchronous and blocking. We need:
1. A queue to hold pending concept update tasks
2. A background processor that works through the queue
3. Priority handling (persona switch = high priority)
4. Coordination with the human concept map race condition protection (0054)

## Proposed Solution

### 1. ConceptQueue Interface (new file: src/concept-queue.ts)
```typescript
export interface ConceptUpdateTask {
  id: string;
  persona: string;
  target: "system" | "human";
  messages: Message[];
  created_at: string;
  priority: "high" | "normal";
}

export class ConceptQueue {
  private static instance: ConceptQueue;
  private queue: ConceptUpdateTask[] = [];
  private processing = false;
  private abortController: AbortController | null = null;
  
  static getInstance(): ConceptQueue;
  
  enqueue(task: Omit<ConceptUpdateTask, "id" | "created_at">): string;
  
  async processNext(): Promise<void>;
  
  async processAll(): Promise<void>;
  
  getQueueLength(): number;
  
  getPendingForPersona(persona: string): ConceptUpdateTask[];
  
  cancelPersonaTasks(persona: string): void;
  
  async shutdown(): Promise<void>;
}
```

### 2. Queue Processing Logic
```typescript
async processNext(): Promise<void> {
  if (this.processing || this.queue.length === 0) return;
  
  // Sort by priority (high first), then by created_at
  this.queue.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority === "high" ? -1 : 1;
    }
    return a.created_at.localeCompare(b.created_at);
  });
  
  const task = this.queue.shift()!;
  this.processing = true;
  this.abortController = new AbortController();
  
  try {
    if (task.target === "system") {
      await this.processSystemConceptUpdate(task);
    } else {
      await this.processHumanConceptUpdate(task);
    }
    
    // Mark messages as concept_processed
    await markMessagesConceptProcessed(
      task.messages.map(m => m.timestamp),
      task.persona
    );
  } catch (err) {
    if (!(err instanceof LLMAbortedError)) {
      appendDebugLog(`ConceptQueue error: ${err}`);
      // Re-queue on failure? Or drop? TBD
    }
  } finally {
    this.processing = false;
    this.abortController = null;
    
    // Process next if queue not empty
    if (this.queue.length > 0) {
      setImmediate(() => this.processNext());
    }
  }
}
```

### 3. Integration with App (app.ts)
```typescript
// In EIApp constructor
private conceptQueue = ConceptQueue.getInstance();

// In cleanup()
await this.conceptQueue.shutdown();
```

### 4. Enqueueing Pattern
```typescript
// Called from queue triggers (0066)
this.conceptQueue.enqueue({
  persona: "ei",
  target: "system",
  messages: unprocessedMessages,
  priority: "normal"
});

this.conceptQueue.enqueue({
  persona: "ei", 
  target: "human",
  messages: unprocessedMessages,
  priority: "normal"
});
```

## Acceptance Criteria
- [x] ConceptQueue singleton class implemented
- [x] Priority-based queue ordering (high before normal)
- [x] FIFO within same priority level
- [x] Background processing with setImmediate for non-blocking
- [x] AbortController support for graceful cancellation
- [x] `shutdown()` method for clean app exit
- [x] Debug logging for queue operations
- [x] Integration points in app.ts documented (see Integration Points section below)
- [x] Unit tests for queue ordering and processing
- [x] Integration test with mock LLM calls

## Value Statement
**Core Async Infrastructure**: This is the backbone of the new architecture. Without a proper queue, we can't decouple concept processing from conversation.

## Dependencies
- 0062: Add concept_processed flag (for marking messages done)
- 0054: Human Concept Map Race Condition (for safe human concept updates)
- Part of 0061: Concept Processing Architecture Overhaul

## Effort Estimate
Medium-Large (~3-4 hours)
- Queue class implementation: 1.5 hours
- Processing logic: 1 hour
- Integration and testing: 1-1.5 hours

## Integration Points (for app.ts)

The ConceptQueue is ready to integrate into `app.ts`. Here's how:

```typescript
// 1. Import at top of app.ts
import { ConceptQueue } from "../concept-queue.js";

// 2. In EIApp class, get the singleton instance
private conceptQueue = ConceptQueue.getInstance();

// 3. In cleanup() method, ensure graceful shutdown
async cleanup(): Promise<void> {
  // ... existing cleanup ...
  await this.conceptQueue.shutdown();
}

// 4. Optionally, set up a task completion callback for UI updates
this.conceptQueue.setTaskCompletionCallback((result) => {
  if (result.conceptsChanged) {
    // Refresh concept display or notify user
  }
});
```

Enqueueing will be handled by ticket 0066 (queue triggers).

## Technical Notes
- Singleton pattern ensures one queue across all persona states
- `setImmediate` prevents blocking the event loop during batch processing
- Consider persisting queue to disk for crash recovery (future enhancement)
- Human concept updates need coordination with 0054's locking mechanism
- May want to add queue status to UI (future ticket?)

## Implementation Notes

Created `src/concept-queue.ts` with:
- `ConceptUpdateTask` interface - defines queue task structure
- `ConceptUpdateResult` interface - returned from task completion callback
- `ConceptQueue` singleton class with:
  - `getInstance()` / `resetInstance()` - singleton management
  - `enqueue()` - add tasks with auto-generated IDs
  - `processNext()` - process one task in priority/FIFO order
  - `getQueueLength()` - current pending count
  - `getPendingForPersona()` - filter by persona
  - `cancelPersonaTasks()` - bulk cancel
  - `isProcessing()` - check active processing
  - `shutdown()` - graceful shutdown with abort
  - `setTaskCompletionCallback()` - optional notification hook

Created `tests/unit/concept-queue.test.ts` with 22 tests covering:
- Singleton pattern behavior
- Enqueue operations and ID generation
- Priority ordering (high before normal)
- FIFO within same priority
- Task completion callbacks
- Error handling
- Shutdown behavior
- Persona filtering and cancellation
