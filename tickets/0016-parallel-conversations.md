# 0016: Parallel Conversations

**Status**: VALIDATED

## Summary

Allow multiple personas to process messages simultaneously. Send a message, switch personas, continue chatting while the first processes.

## Problem

Current architecture is single-threaded: one message queue, one `isProcessing` flag, one active persona. Switching personas while processing loses context.

## Proposed Solution

### Concurrent Processing Model

Each persona runs independently:
```typescript
// Multiple personas can be processing simultaneously
personaStates.get("ei").isProcessing = true;   // EI thinking
personaStates.get("mike").isProcessing = true; // Mike also thinking
// User chatting with lena while both process
```

### Event Loop Integration

```typescript
// Each persona has its own processing loop
async function runPersonaLoop(personaName: string) {
  while (true) {
    await processNextMessage(personaName);
    await sleep(100); // Small delay between checks
  }
}

// Start loops for all personas on init
personas.forEach(p => runPersonaLoop(p.name));
```

### UI Updates

- Active persona's messages appear immediately
- Background persona responses trigger unread indicator
- Processing indicators show per-persona status

### Resource Considerations

- Multiple concurrent LLM calls (local models may queue anyway)
- Memory for multiple conversation contexts
- AbortController per persona for clean cancellation

### Ctrl+C Behavior (Priority Order)

When user presses Ctrl+C, check in order:
1. **Active persona is processing** → Abort that processing, stay in app
2. **Text in input field** → Clear the input field, stay in app
3. **Background persona is processing** → Show warning: "Operation in progress for [persona]. Press Ctrl+C again to exit."
4. **Warning is displayed OR no conditions met** → Exit app

This gives users escape hatches at each level without accidentally killing background work.

### State Synchronization

```typescript
// Global state updates trigger re-render
const [personaStates, dispatch] = useReducer(personaReducer, initialStates);

// Actions
dispatch({ type: "MESSAGE_SENT", persona: "ei", content: "..." });
dispatch({ type: "RESPONSE_RECEIVED", persona: "mike", content: "..." });
```

## Acceptance Criteria

- [x] Send message to persona A, switch to B, A continues processing
- [x] Multiple personas can have pending LLM calls
- [x] Responses from background personas queue properly
- [x] Switching back shows completed responses
- [x] Abort works per-persona (Ctrl+C only affects active)
- [x] No race conditions in state updates

## Implementation Notes

Foundation was built in tickets 0008/0009 with per-persona `PersonaState` containing:
- Independent `isProcessing`, `messageQueue`, `abortController`
- Background response handling that increments `unreadCount`

Added smart Ctrl+C behavior in App.tsx:
- Priority-based handling (active processing → input text → background warning → exit)
- `inputClearTrigger` pattern to clear InputArea from parent
- `ctrlCWarningShown` state for two-press exit confirmation

## Value Statement

True multi-tasking. Start deep conversations with multiple personas without waiting.

## Dependencies

- Ticket 0008 (multi-persona heartbeat) 
- Ticket 0009 (per-persona queues)
- Ticket 0010 (ink layout for visual updates)

## Effort Estimate

Large: ~6-8 hours
