# 0009: Per-Persona Message Queues and Read Tracking

**Status**: VALIDATED

## Summary

Replace single global message queue with per-persona queues. Add read/unread tracking for incoming messages.

## Problem

Current implementation:
- Single `messageQueue` array for all messages
- Single `isProcessing` flag blocks everything
- Switching personas kills the queue
- No concept of "unread" messages

This prevents parallel conversations and loses context on persona switch.

## Proposed Solution

### Per-Persona State

```typescript
interface PersonaState {
  name: string;
  messageQueue: string[];
  isProcessing: boolean;
  pendingResponse: boolean;  // Waiting for LLM
  unreadCount: number;
  lastMessageTime: number;
}
```

### Queue Behavior

- Each persona has its own queue
- Sending a message adds to that persona's queue only
- `isProcessing` is per-persona, not global
- Multiple personas can process simultaneously

### Read Tracking

- Messages from persona increment `unreadCount`
- Switching to persona resets `unreadCount` to 0
- UI shows unread indicator (bold name, badge, etc.)

### Processing Model

```typescript
async function processPersonaQueue(personaName: string) {
  const state = personaStates.get(personaName);
  if (!state || state.isProcessing || state.messageQueue.length === 0) return;
  
  state.isProcessing = true;
  // ... process messages ...
  state.isProcessing = false;
  
  if (personaName !== activePersona) {
    state.unreadCount++;
  }
}
```

## Acceptance Criteria

- [x] Each persona has independent message queue
- [x] Sending message to inactive persona queues it properly
- [x] Multiple personas can process LLM calls simultaneously
- [x] Unread count increments for background persona responses
- [x] Switching personas clears unread count
- [x] Persona switch doesn't lose queued messages

## Value Statement

Have multiple conversations at once. Start a thought with Mike, switch to Lena while waiting, come back to see Mike's response.

## Dependencies

- Works in tandem with 0008 (multi-persona heartbeat)

## Effort Estimate

Medium-Large: ~4-5 hours
