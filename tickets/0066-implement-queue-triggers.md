# 0066: Implement Queue Triggers (Switch, Stale Messages)

**Status**: DONE

## Summary
Implement the logic that determines when to enqueue concept update tasks. This creates the "smart" triggers that replace the current every-message approach with targeted updates.

## Problem
With concept updates decoupled from conversation (0065), we need to decide when to actually process concepts. The goals are:
1. Keep concepts reasonably fresh without blocking conversation
2. Prioritize active persona updates
3. Ensure no messages go unprocessed indefinitely

## Proposed Solution

### 1. Persona Switch Trigger (High Priority)
When switching personas, queue updates for the backgrounded persona:

```typescript
// In app.ts switchPersona()
async switchPersona(newPersona: string) {
  const oldPersona = this.activePersona;
  
  // Queue concept updates for persona being backgrounded
  const unprocessedMessages = await getUnprocessedMessages(oldPersona);
  if (unprocessedMessages.length > 0) {
    // System concepts for the old persona
    ConceptQueue.getInstance().enqueue({
      persona: oldPersona,
      target: "system",
      messages: unprocessedMessages,
      priority: "high" // Process before normal tasks
    });
    
    // Human concepts (learned by old persona)
    ConceptQueue.getInstance().enqueue({
      persona: oldPersona,
      target: "human", 
      messages: unprocessedMessages,
      priority: "high"
    });
  }
  
  // Continue with switch...
  this.activePersona = newPersona;
  // ...
}
```

### 2. Stale Message Trigger (Normal Priority)
Check periodically for messages older than 20 minutes that haven't been processed:

```typescript
// New method in app.ts
private staleMessageCheckInterval: NodeJS.Timeout | null = null;
private STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
private STALE_MESSAGE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

private startStaleMessageChecker() {
  this.staleMessageCheckInterval = setInterval(
    () => this.checkForStaleMessages(),
    this.STALE_CHECK_INTERVAL_MS
  );
}

private async checkForStaleMessages() {
  const cutoff = Date.now() - this.STALE_MESSAGE_THRESHOLD_MS;
  
  for (const persona of this.personas) {
    const staleMessages = await getUnprocessedMessages(persona.name, cutoff);
    
    if (staleMessages.length > 0) {
      appendDebugLog(`Found ${staleMessages.length} stale messages for ${persona.name}`);
      
      ConceptQueue.getInstance().enqueue({
        persona: persona.name,
        target: "system",
        messages: staleMessages,
        priority: "normal"
      });
      
      ConceptQueue.getInstance().enqueue({
        persona: persona.name,
        target: "human",
        messages: staleMessages,
        priority: "normal"
      });
    }
  }
}
```

### 3. Cleanup Integration
```typescript
// In cleanup()
if (this.staleMessageCheckInterval) {
  clearInterval(this.staleMessageCheckInterval);
}
```

### 4. Startup Integration
```typescript
// In init()
this.startStaleMessageChecker();
```

## Acceptance Criteria
- [x] Persona switch triggers high-priority queue tasks for backgrounded persona
- [x] Stale message checker runs every 5 minutes
- [x] Messages older than 20 minutes get queued for processing
- [x] Both system and human concept updates queued together
- [x] Checker properly cleaned up on app exit
- [x] Debug logging for trigger events
- [x] Thresholds are configurable constants
- [ ] Unit tests for trigger logic (existing integration tests pass, no new unit tests added)
- [ ] Integration test: switch persona -> verify queue populated (coverage through existing tests)

## Value Statement
**Smart Processing**: These triggers ensure concepts stay fresh while eliminating wasteful every-message updates. The 20-minute rule prevents indefinite staleness.

## Dependencies
- 0062: Add concept_processed flag (for getUnprocessedMessages)
- 0064: Implement ConceptQueue (for enqueueing)
- Part of 0061: Concept Processing Architecture Overhaul

## Effort Estimate
Medium (~2-3 hours)
- Persona switch trigger: 45 minutes
- Stale message checker: 1 hour
- Integration and testing: 45 minutes

## Technical Notes
- 20-minute threshold is tunable - may need adjustment based on usage patterns
- 5-minute check interval balances responsiveness vs overhead
- High priority for switch ensures backgrounded persona catches up quickly
- Consider adding manual `/sync` command trigger (future enhancement)
- Stale checker should skip if queue already has pending tasks for persona
