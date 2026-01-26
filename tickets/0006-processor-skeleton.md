# 0006: Processor Skeleton & Loop

**Status**: PENDING
**Depends on**: 0004, 0005

## Summary

Implement the Processor—the orchestration layer that runs the main loop, manages scheduled tasks, dispatches LLM response handlers, and exposes the API to the Frontend.

## Acceptance Criteria

- [ ] Create `src/core/processor.ts` implementing the Processor interface from CONTRACTS.md
- [ ] Implement lifecycle methods (`start()`, `stop()`)
- [ ] Implement the main loop that:
  - Checks auto-save interval
  - Checks scheduled tasks (heartbeat eligibility)
  - Peeks queue and starts QueueProcessor if idle
- [ ] Implement handler dispatch based on `LLMNextStep`
- [ ] Implement all Processor API methods (stub implementations OK for first pass)
- [ ] Wire up StateManager and QueueProcessor
- [ ] Create handler stubs for all `LLMNextStep` values

## Implementation Notes

### Main Loop

```typescript
private async runLoop(): Promise<void> {
  while (this.running) {
    // 1. Auto-save check
    if (this.shouldAutoSave()) {
      await this.stateManager.persist();
      this.interface.onStatePersisted?.();
    }
    
    // 2. Scheduled tasks (heartbeats, decay, etc.)
    await this.checkScheduledTasks();
    
    // 3. Queue processing
    if (this.queueProcessor.getState() === "idle") {
      const request = this.stateManager.queue_peekHighest();
      if (request) {
        this.queueProcessor.start(request, (response) => {
          this.handleResponse(response);
        });
      }
    }
    
    // 4. Yield to event loop
    await this.sleep(100); // 100ms tick
  }
}
```

### Handler Dispatch

```typescript
private handleResponse(response: LLMResponse): void {
  const handler = this.handlers[response.request.next_step];
  if (!handler) {
    console.error(`No handler for ${response.request.next_step}`);
    this.stateManager.queue_fail(response.request.id, "No handler");
    return;
  }
  
  try {
    handler(response, this.stateManager);
    this.stateManager.queue_complete(response.request.id);
  } catch (err) {
    this.stateManager.queue_fail(response.request.id, err.message);
  }
}
```

### Stub Handlers

For this ticket, handlers can be stubs that just log and complete:

```typescript
const handlers: Record<LLMNextStep, Handler> = {
  [LLMNextStep.HandlePersonaResponse]: (response, state) => {
    console.log("TODO: HandlePersonaResponse");
  },
  // ... etc
};
```

Real handler implementations will be separate tickets.

## File Structure

```
src/
└── core/
    ├── types.ts
    ├── state-manager.ts
    ├── queue-processor.ts
    ├── processor.ts        # NEW
    ├── handlers/           # NEW (can be empty stubs initially)
    │   └── index.ts
    └── index.ts
```
