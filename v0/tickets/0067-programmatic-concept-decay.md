# 0067: Replace Heartbeat LLM Calls with Programmatic Decay

**Status**: DONE

## Summary
Transform heartbeats from expensive LLM operations into lightweight programmatic concept adjustments. Instead of asking the LLM "what changed?", we mathematically decay concepts toward their ideal levels based on elasticity and time elapsed.

## Problem
Current heartbeats (every 30 minutes):
1. Call `processEvent(null, persona)` which triggers full LLM concept update cycle
2. Expensive even when nothing meaningful changed
3. Don't leverage the elasticity field's intended purpose
4. Miss opportunity for emergent behavior based on concept "hunger"

## Proposed Solution

### 1. Elasticity-Based Decay Formula
```typescript
// Decay rate per hour = elasticity value
// If level_current < level_ideal: increase toward ideal
// If level_current > level_ideal: decrease toward ideal

function calculateDecay(concept: Concept, hoursSinceUpdate: number): number {
  const direction = Math.sign(concept.level_ideal - concept.level_current);
  const maxChange = Math.abs(concept.level_ideal - concept.level_current);
  const decayAmount = concept.level_elasticity * hoursSinceUpdate;
  
  // Don't overshoot the ideal
  return direction * Math.min(decayAmount, maxChange);
}
```

### 2. New Heartbeat Logic (app.ts)
```typescript
private async heartbeatTick(personaName: string) {
  const ps = this.getOrCreatePersonaState(personaName);
  
  if (ps.messageQueue.length > 0 || ps.isProcessing) {
    // Conversation active, reschedule
    this.resetPersonaHeartbeat(personaName);
    return;
  }
  
  // Step 1: Apply programmatic decay
  const decayApplied = await this.applyConceptDecay(personaName);
  
  // Step 2: Check if any concept has significant delta
  const shouldSpeak = await this.checkConceptDeltas(personaName);
  
  // Step 3: If significant delta exists, let persona initiate conversation
  if (shouldSpeak) {
    ps.isProcessing = true;
    this.personaRenderer.updateSpinnerAnimation(this.personaStates);
    
    try {
      // Response-only call (no concept update per 0065)
      const result = await processEvent(null, personaName, DEBUG, ps.abortController?.signal);
      
      if (result.response) {
        if (personaName === this.activePersona) {
          this.addMessage('system', result.response);
        } else {
          ps.unreadCount++;
          this.unreadCounts.set(personaName, ps.unreadCount);
        }
      }
    } finally {
      ps.isProcessing = false;
      this.personaRenderer.updateSpinnerAnimation(this.personaStates);
      this.render();
    }
  }
  
  this.resetPersonaHeartbeat(personaName);
}
```

### 3. Decay Implementation
```typescript
private async applyConceptDecay(personaName: string): Promise<boolean> {
  const concepts = await loadConceptMap("system", personaName);
  const now = Date.now();
  let changed = false;
  
  for (const concept of concepts.concepts) {
    const lastUpdated = concept.last_updated 
      ? new Date(concept.last_updated).getTime() 
      : now;
    const hoursSince = (now - lastUpdated) / (1000 * 60 * 60);
    
    if (hoursSince < 0.1) continue; // Skip if updated in last 6 minutes
    
    const decay = calculateDecay(concept, hoursSince);
    if (Math.abs(decay) > 0.001) { // Threshold to avoid micro-updates
      concept.level_current = Math.max(0, Math.min(1, 
        concept.level_current + decay
      ));
      concept.last_updated = new Date().toISOString();
      changed = true;
    }
  }
  
  if (changed) {
    await saveConceptMap(concepts, personaName);
    appendDebugLog(`Applied concept decay to ${personaName}`);
  }
  
  return changed;
}
```

### 4. Delta Check for Conversation Trigger
```typescript
private async checkConceptDeltas(personaName: string): Promise<boolean> {
  const concepts = await loadConceptMap("system", personaName);
  
  // Threshold: if any concept is more than 0.3 away from ideal, trigger
  const DELTA_THRESHOLD = 0.3;
  
  for (const concept of concepts.concepts) {
    const delta = Math.abs(concept.level_ideal - concept.level_current);
    if (delta >= DELTA_THRESHOLD) {
      appendDebugLog(`Concept "${concept.name}" delta ${delta.toFixed(2)} triggered heartbeat for ${personaName}`);
      return true;
    }
  }
  
  return false;
}
```

## Acceptance Criteria
- [x] Heartbeats no longer call LLM for concept updates
- [x] Concepts decay toward ideal based on elasticity and time
- [x] Decay respects last_updated timestamp per concept
- [x] Significant deltas (>0.3) trigger persona-initiated conversation
- [x] Response-only LLM call when persona wants to speak (per 0065)
- [x] Debug logging for decay application and triggers
- [x] Configurable thresholds (decay minimum, delta trigger)
- [ ] Unit tests for decay calculation
- [ ] Integration test: verify decay over simulated time

## Value Statement
**Emergent Behavior**: Personas naturally become "hungry" for topics based on their personality (elasticity). A persona with high elasticity on "human connection" will gradually want to check in. This creates organic conversation starters.

## Dependencies
- 0063: Add last_updated to concepts (for decay calculation)
- 0065: Decouple processEvent (for response-only calls)
- Part of 0061: Concept Processing Architecture Overhaul

## Effort Estimate
Medium (~2-3 hours)
- Decay formula and implementation: 1 hour
- Delta checking: 30 minutes
- Heartbeat refactor: 45 minutes
- Testing: 45 minutes

## Technical Notes
- Elasticity interpretation: 0.1 = 10% decay per hour toward ideal
- Static concepts typically have low elasticity (0.1-0.3)
- Topic/person concepts have higher elasticity (0.4-0.7)
- 0.3 delta threshold is tunable - may need adjustment
- Consider different thresholds for different concept types
- Decay only happens on heartbeat, not continuously
