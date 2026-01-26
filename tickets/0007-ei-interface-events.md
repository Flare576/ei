# 0007: Ei_Interface & Event System

**Status**: PENDING
**Depends on**: 0006

## Summary

Wire up the Ei_Interface event system so the Processor can notify the Frontend when state changes. This completes the Processor → Frontend communication channel.

## Acceptance Criteria

- [ ] Processor constructor accepts `Ei_Interface` parameter
- [ ] All events fire at the correct times (per CONTRACTS.md "Event Emission Rules")
- [ ] Events with payloads pass the correct data (`personaName` for message events, etc.)
- [ ] Events are optional—missing handlers don't crash
- [ ] Add event emissions to all relevant StateManager operations
- [ ] Integration test: mock Ei_Interface, verify events fire

## Implementation Notes

### Event Wiring

The Processor should wrap StateManager calls to emit events:

```typescript
async sendMessage(personaName: string, content: string): Promise<void> {
  // Add human message
  const message = createMessage(content, "human");
  this.stateManager.messages_append(personaName, message);
  this.interface.onMessageAdded?.(personaName);
  
  // Queue response
  const request = this.buildResponseRequest(personaName);
  this.stateManager.queue_enqueue(request);
  this.interface.onMessageQueued?.(personaName);
}
```

### QueueProcessor State Events

```typescript
// In the main loop, when starting a request:
this.interface.onQueueStateChanged?.("busy");
this.interface.onMessageProcessing?.(personaName);

// In the callback:
this.interface.onQueueStateChanged?.("idle");
```

### Error Events

```typescript
// When LLM fails after retries:
this.interface.onError?.({
  code: "LLM_RATE_LIMITED",
  message: "Rate limit exceeded for provider X"
});
```

## Testing

Create a mock Ei_Interface that records all event calls:

```typescript
function createMockInterface(): { interface: Ei_Interface; calls: string[] } {
  const calls: string[] = [];
  return {
    interface: {
      onPersonaAdded: () => calls.push("onPersonaAdded"),
      onMessageAdded: (name) => calls.push(`onMessageAdded:${name}`),
      // etc.
    },
    calls
  };
}
```
