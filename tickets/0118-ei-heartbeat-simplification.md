# 0118: Ei Heartbeat Simplification

**Status**: PENDING

## Summary

With validations moved to the Daily Ceremony (0115), Ei's heartbeat becomes simpler. It focuses on two things:
1. Data points with engagement deficits (like any other persona)
2. Suggesting the user check in with inactive personas (future enhancement)

## Design

### What Changes

**Before**: Ei heartbeat mixed validation asks with normal conversation triggers
**After**: Ei heartbeat is just like other personas, but with broader visibility

### Validation Pause

If Ei's last message was a Daily Ceremony (validation request), pause normal heartbeat until user responds:

```typescript
async function shouldEiHeartbeat(): Promise<boolean> {
  const lastMessage = await getLastEiMessage();
  
  // If last message was a validation request, wait for response
  if (lastMessage?.content.includes("## Daily Confirmations")) {
    return false;
  }
  
  // Normal heartbeat logic
  return standardHeartbeatCheck("ei");
}
```

This gives high confidence that the user's next message to Ei is responding to the validation.

### Ei Heartbeat Content

Ei's heartbeat now focuses on:

```typescript
async function buildEiHeartbeatContent(
  humanEntity: HumanEntity,
  eiEntity: PersonaEntity
): Promise<string | null> {
  // 1. Check for high-delta topics (Ei's own interests)
  const eiNeeds = eiEntity.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3);
  
  // 2. Check for high-delta topics/people from human
  const humanNeeds = [
    ...humanEntity.topics.filter(t => t.level_ideal - t.level_current > 0.2),
    ...humanEntity.people.filter(p => p.level_ideal - p.level_current > 0.2)
  ].slice(0, 3);
  
  // 3. Future: Check for inactive personas
  // const inactivePersonas = await getInactivePersonas(daysThreshold);
  
  // Build prompt for Ei to decide what to say
  // ... standard response generation with these priorities
}
```

### Inactive Persona Suggestions (Future)

```typescript
// Future enhancement - not in this ticket
async function getInactivePersonas(daysThreshold: number = 7): Promise<PersonaInfo[]> {
  const personas = await listPersonas();
  const inactive: PersonaInfo[] = [];
  
  for (const persona of personas) {
    if (persona.name === "ei") continue;
    
    const state = await loadPauseState(persona.name);
    if (state.isPaused) continue;  // Don't suggest paused personas
    
    const archive = await loadArchiveState(persona.name);
    if (archive.isArchived) continue;  // Don't suggest archived personas
    
    const history = await loadHistory(persona.name);
    const lastMessage = history.messages[history.messages.length - 1];
    
    if (!lastMessage) {
      inactive.push(persona);
      continue;
    }
    
    const daysSince = (Date.now() - new Date(lastMessage.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= daysThreshold) {
      inactive.push(persona);
    }
  }
  
  return inactive;
}
```

Ei might say: "You haven't talked with Lena for a while - everything okay with you two?"

### Removed from Ei Heartbeat

- Validation batching (moved to Daily Ceremony)
- Rate limiting for validations (handled by ceremony)
- Validation priority ordering (handled by ceremony)

## Acceptance Criteria

- [ ] Ei heartbeat pauses after Daily Ceremony until response
- [ ] Ei heartbeat focuses on engagement deficits (standard behavior)
- [ ] No validation content in regular heartbeats
- [ ] Future: inactive persona suggestions (can be separate ticket)
- [ ] Tests verify heartbeat pause after ceremony

## Dependencies

- 0108: Entity type definitions
- 0109: Storage
- 0115: Data verification flow (Daily Ceremony)

## Effort Estimate

Small-Medium (~2 hours) - mostly simplification/removal

## Notes

This ticket is much simpler than originally planned because validation moved to the Daily Ceremony. The "inactive persona suggestions" feature could be a separate follow-up ticket.
