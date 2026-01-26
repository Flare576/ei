# 0124: Time-Based Core Logic (Simplified)

**Status**: QA

## Summary

Add two simple `setInterval` timers to `app.ts` for system-wide maintenance: Daily Ceremony and Topic/People Decay. This is a pragmatic, minimal implementation - heartbeat refactoring out of the UI layer is tracked separately in 0129.

## Background

Currently, decay only runs when heartbeats fire (after 30min of inactivity per-persona). If the user keeps talking, topics never decay - they stay at high `level_current` forever. Daily Ceremony logic exists but is never triggered.

## What We're NOT Doing

- **Stale message checking**: Already handled by per-message extraction triggers in `processor.ts`
- **ScheduledJobManager abstraction**: Overkill for 2 simple timers
- **Persistence file**: Unnecessary - ceremony tracks via `ceremony_config.last_ceremony`, decay is self-correcting
- **Heartbeat refactoring**: Out of scope (tracked in ticket 0129)

## Implementation

### 1. Daily Ceremony Timer

Add to `app.ts` constructor or `startApp()`:

```typescript
// Check every 5 minutes if it's time for Daily Ceremony
this.dailyCeremonyInterval = setInterval(async () => {
  await this.checkDailyCeremony();
}, 5 * 60 * 1000);
```

Handler logic:

```typescript
private async checkDailyCeremony(): Promise<void> {
  // Use existing verification.ts functions
  const entity = await loadHumanEntity();
  const config = entity.ceremony_config || { enabled: true, time: "09:00" };
  
  if (!config.enabled) return;
  
  const now = new Date();
  
  // Check if it's past ceremony time
  const [hours, minutes] = config.time.split(':').map(Number);
  const ceremonyMinutes = hours * 60 + minutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  
  if (nowMinutes < ceremonyMinutes) return;
  
  // Check if already ran today
  if (config.last_ceremony) {
    const lastRun = new Date(config.last_ceremony);
    if (lastRun.toDateString() === now.toDateString()) return;
  }
  
  // Build and send ceremony message
  const message = await buildDailyCeremonyMessage();
  if (!message) return;
  
  // Append to Ei's history with read: false
  await appendMessage({
    role: "system",
    content: message,
    timestamp: new Date().toISOString(),
    read: false
  }, "ei");
  
  // Update unread count if Ei isn't active
  if (this.activePersona !== "ei") {
    const ps = this.getOrCreatePersonaState("ei");
    ps.unreadCount++;
    this.unreadCounts.set("ei", ps.unreadCount);
    this.personaRenderer.updateSpinnerAnimation(this.personaStates);
  }
  
  // Record ceremony completion
  await recordCeremony();
  
  appendDebugLog('[DailyCeremony] Triggered at ' + now.toISOString());
}
```

### 2. Decay Timer

Add to `app.ts` constructor or `startApp()`:

```typescript
// Run decay every hour
this.decayInterval = setInterval(async () => {
  await this.runDecay();
}, 60 * 60 * 1000);
```

Handler logic:

```typescript
private async runDecay(): Promise<void> {
  try {
    // Decay human entity
    await applyTopicDecay('human');
    
    // Decay all persona entities
    const personas = await listPersonas();
    for (const persona of personas) {
      await applyTopicDecay('system', persona.name);
    }
    
    appendDebugLog('[Decay] Applied to all entities');
  } catch (err) {
    appendDebugLog(`[Decay] Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

### 3. Cleanup on Shutdown

Update existing cleanup logic:

```typescript
async cleanup(): Promise<void> {
  // Clear intervals
  if (this.dailyCeremonyInterval) {
    clearInterval(this.dailyCeremonyInterval);
    this.dailyCeremonyInterval = null;
  }
  
  if (this.decayInterval) {
    clearInterval(this.decayInterval);
    this.decayInterval = null;
  }
  
  // ... existing cleanup
}
```

### 4. Add Instance Variables

```typescript
export class EIApp {
  // ... existing fields
  
  private dailyCeremonyInterval: NodeJS.Timeout | null = null;
  private decayInterval: NodeJS.Timeout | null = null;
  
  // ...
}
```

## Verification Logic Already Exists

From `verification.ts`:
- `buildDailyCeremonyMessage()` - Builds ceremony message (line 230)
- `recordCeremony()` - Updates `ceremony_config.last_ceremony` (line 273)
- `wasLastEiMessageCeremony()` - Checks if ceremony is waiting for response (line 410)

From `topic-decay.ts`:
- `applyTopicDecay(entityType, persona?)` - Applies logarithmic decay (line 17)
- Decay math is proportional to elapsed time, so exact interval doesn't matter

## Acceptance Criteria

- [x] Daily Ceremony timer runs every 5 minutes and checks conditions
- [x] Ceremony only triggers once per day at configured time
- [x] Ceremony message appears in Ei's history with unread indicator
- [x] Decay timer runs every hour
- [x] Decay applies to human entity and all personas
- [x] Both intervals are cleaned up on app shutdown
- [x] Debug logging shows when timers fire

## Dependencies

- 0115: Daily Ceremony logic (already implemented)
- Existing `applyTopicDecay` function

## Effort Estimate

Small (~1 hour) - just wiring up existing functions to timers

## Notes

### Why No Persistence?

- **Daily Ceremony**: Uses existing `ceremony_config.last_ceremony` timestamp to prevent double-runs
- **Decay**: Self-correcting - decay amount is proportional to elapsed time since last update, so if we miss an hour, the next run compensates

### Why Check Ceremony Every 5 Minutes?

- Simple, predictable behavior
- Worst case: ceremony triggers up to 5min late (acceptable for a "morning routine" feature)
- Alternative would be calculating exact time-until-9am and using `setTimeout`, but that's more complex for minimal benefit

### Future Work (Ticket 0129)

Extract ALL time-based core logic from `app.ts`:
- Heartbeat system (30min inactivity timers)
- Pause/resume timers
- Decay scheduling (this ticket)
- Daily Ceremony (this ticket)

Create dedicated `scheduler.ts` or similar to handle all timing concerns outside the UI layer. For now, we're pragmatically adding to `app.ts` rather than letting perfect be the enemy of done.
