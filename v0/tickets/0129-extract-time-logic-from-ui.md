# 0129: Extract Time-Based Core Logic from UI Layer

**Status**: PENDING

## Summary

Move all timer-based core functionality out of `blessed/app.ts` into dedicated scheduler module(s). This is the "elephant in the room" problem - heartbeats, decay, ceremony, and pause timers are deeply intertwined with UI state and need careful extraction.

## Background

As of ticket 0124, `app.ts` contains ALL time-based logic:
- **Heartbeat timers** (30min inactivity per-persona)
- **Pause/resume timers** (persona-specific auto-resume)
- **Debounce timers** (message processing delays)
- **Daily Ceremony timer** (added in 0124)
- **Decay timer** (added in 0124)

This violates separation of concerns - core business logic (when to generate responses, when to decay topics) is trapped in the UI layer.

## The Problem

Heartbeat logic is especially entangled:

```typescript
// Lines 2173-2295 in app.ts
ps.heartbeatTimer = setTimeout(async () => {
  // Checks persona pause state
  // Loads entities
  // Calls LLM
  // Updates UI state (isProcessing, spinner animation)
  // Manages queue processor pause/resume
  // Increments unread counts
  // Calls this.addMessage() or manually updates personaStates
  // Resets itself with this.resetPersonaHeartbeat()
}, HEARTBEAT_INTERVAL_MS);
```

**Dependencies on UI state:**
- `PersonaState` (timers, processing flags, unread counts)
- `personaRenderer.updateSpinnerAnimation()`
- `queueProcessor.pause()/resume()`
- `this.addMessage()` (adds to `this.messages` array)
- `this.render()` (Blessed screen update)
- `this.activePersona` (determines message destination)

## Design Goals

1. **Core logic in separate module**: `scheduler.ts` or `time-events.ts`
2. **Event-based communication**: Scheduler emits events, UI subscribes
3. **No UI state in scheduler**: Pass callbacks/handlers from `app.ts`
4. **Testable without Blessed**: Can unit test timing logic independently

## Proposed Architecture

### Option A: Event Emitter Pattern

```typescript
// src/scheduler.ts
export class Scheduler extends EventEmitter {
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private decayInterval: NodeJS.Timeout | null = null;
  private ceremonyInterval: NodeJS.Timeout | null = null;
  
  scheduleHeartbeat(persona: string, delayMs: number): void {
    this.clearHeartbeat(persona);
    
    const timer = setTimeout(() => {
      this.emit('heartbeat', { persona });
    }, delayMs);
    
    this.heartbeatTimers.set(persona, timer);
  }
  
  startDecay(intervalMs: number): void {
    this.decayInterval = setInterval(() => {
      this.emit('decay');
    }, intervalMs);
  }
  
  // ...
}

// src/blessed/app.ts
const scheduler = new Scheduler();

scheduler.on('heartbeat', async ({ persona }) => {
  await this.handleHeartbeat(persona);
});

scheduler.on('decay', async () => {
  await this.runDecay();
});
```

### Option B: Callback Registration

```typescript
// src/scheduler.ts
export class Scheduler {
  private onHeartbeat: (persona: string) => Promise<void>;
  private onDecay: () => Promise<void>;
  
  constructor(handlers: SchedulerHandlers) {
    this.onHeartbeat = handlers.heartbeat;
    this.onDecay = handlers.decay;
  }
  
  scheduleHeartbeat(persona: string, delayMs: number): void {
    // ... setTimeout(() => this.onHeartbeat(persona), delayMs)
  }
}

// src/blessed/app.ts
this.scheduler = new Scheduler({
  heartbeat: (persona) => this.handleHeartbeat(persona),
  decay: () => this.runDecay(),
  ceremony: () => this.checkDailyCeremony(),
});
```

## Challenges

### 1. PersonaState Management

**Current**: Timers stored directly in `PersonaState`

```typescript
interface PersonaState {
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  pauseTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  // ... other UI state
}
```

**Proposed**: Scheduler owns timers, exposes queries

```typescript
// In scheduler
isHeartbeatScheduled(persona: string): boolean
getHeartbeatTimeRemaining(persona: string): number

// In app.ts - query scheduler for display
const timeRemaining = this.scheduler.getHeartbeatTimeRemaining(persona);
```

### 2. Unread Count Updates

**Current**: Heartbeat directly manipulates `this.unreadCounts` map

**Proposed**: Return result, let app handle display

```typescript
scheduler.on('heartbeat', async ({ persona }) => {
  const result = await this.generateHeartbeatResponse(persona);
  
  if (persona !== this.activePersona) {
    // Handle unread count in UI layer
    const ps = this.getOrCreatePersonaState(persona);
    ps.unreadCount++;
    this.unreadCounts.set(persona, ps.unreadCount);
  }
});
```

### 3. Ceremony Message Delivery

**Current**: Ceremony logic directly appends messages and updates UI state

**Proposed**: Return message, let app handle delivery

```typescript
scheduler.on('ceremony', async () => {
  const message = await buildDailyCeremonyMessage();
  if (message) {
    this.deliverSystemMessage('ei', message);
  }
});
```

## Migration Strategy

Phased approach to avoid breaking everything:

### Phase 1: Simple Timers (Decay, Ceremony)
- Extract decay and ceremony intervals (added in 0124)
- These have minimal UI dependencies
- Validate event pattern works

### Phase 2: Pause Timers
- Extract persona pause/resume logic
- Still persona-specific but simpler than heartbeat

### Phase 3: Heartbeat (The Elephant)
- Most complex - requires careful refactoring
- Consider doing this per-persona (Ei first, then others)
- May require intermediate state where some logic stays in app.ts

## Acceptance Criteria

- [ ] All timer logic moved out of `blessed/app.ts`
- [ ] Scheduler module can be unit tested without Blessed
- [ ] UI still functions identically (no behavior changes)
- [ ] PersonaRenderer can query timer state for display
- [ ] Cleanup happens correctly on shutdown
- [ ] Debug logging preserved

## Dependencies

- 0124: Time-based logic (establishes current baseline)

## Effort Estimate

Large (~8-12 hours) - this is a significant refactoring

## Notes

This is the ticket where Flare and Claude drink their respective beverages and commiserate about how the elephant got into the apartment in the first place. 🐘🥃⚡

**Why it matters:**
- Testing: Can't properly test heartbeat logic without spinning up Blessed
- Maintainability: Timer logic scattered across 200+ lines of UI code
- Separation of concerns: When to do things vs. how to display them
- Future UI migrations: If we ever move away from Blessed, timers should move with core logic

**Why it's hard:**
- Heartbeat touches ~6 different UI subsystems
- PersonaState is a grab-bag of processing state AND display state
- Timer state is currently used for both "when to fire" AND "what to show user"
- 10+ methods in `app.ts` that interact with timers

Take it slow. Do it in phases. Test aggressively. This is refactoring, not rewriting.
