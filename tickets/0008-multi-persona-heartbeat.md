# 0008: Multi-Persona Heartbeat System

**Status**: VALIDATED

## Summary

Redesign heartbeat system to support per-persona timers, allowing each persona to independently decide when to reach out.

## Problem

Current implementation has a single global heartbeat timer tied to the active persona. When switching personas:
- The old persona's heartbeat is abandoned
- Only the currently viewed persona can initiate contact
- Background personas have no presence

## Proposed Solution

Each persona maintains its own heartbeat timer. Heartbeats fire regardless of which persona is currently selected.

### Architecture

```typescript
interface PersonaState {
  name: string;
  heartbeatTimer: NodeJS.Timeout | null;
  lastActivity: number;
  isProcessing: boolean;
  messageQueue: string[];
  unreadCount: number;
}

const personaStates: Map<string, PersonaState> = new Map();
```

### Heartbeat Flow

1. On app start, initialize heartbeat timers for all known personas
2. Each persona's timer fires independently
3. When a heartbeat fires:
   - Run `processEvent(null, personaName)` for that persona
   - If response generated, increment `unreadCount` (unless persona is active)
   - Reset that persona's timer
4. User activity on a persona resets its timer

### Timer Management

- Personas not interacted with recently: longer intervals
- Recently active personas: standard interval
- Currently selected persona: standard interval, but messages show immediately

## Acceptance Criteria

- [x] Each persona has independent heartbeat timer
- [x] Heartbeats fire for background personas
- [x] Switching personas doesn't kill other timers
- [x] Activity resets the appropriate persona's timer
- [x] Heartbeat messages from background personas are queued

## Value Statement

Personas feel more alive - they can reach out even when you're talking to someone else.

## Dependencies

- Ticket 0009 (per-persona message queues) - can be developed in parallel

## Effort Estimate

Medium: ~3-4 hours
