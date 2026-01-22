# 0118: Ei Heartbeat Simplification

**Status**: DONE

## Summary

With validations moved to the Daily Ceremony (0115), Ei's heartbeat becomes simpler and gains a new responsibility: monitoring persona engagement. Ei's heartbeat now focuses on:

1. Data points with engagement deficits (like any other persona)
2. Suggesting the user check in with inactive personas

## Design

### What Changes

**Before**: Ei heartbeat mixed validation asks with normal conversation triggers
**After**: Ei heartbeat is like other personas but with broader visibility + inactive persona awareness

### Schema Change: Track Inactivity Pings

Add a field to `PersonaEntity` in `types.ts`:

```typescript
interface PersonaEntity {
  // ... existing fields ...
  
  /** ISO timestamp when Ei last suggested checking in with this inactive persona */
  lastInactivityPing?: string;
}
```

This prevents Ei from nagging about the same persona repeatedly.

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

### Inactive Persona Detection

Detect personas the user hasn't messaged in a while (but hasn't paused/archived):

```typescript
interface InactivePersonaInfo {
  name: string;
  aliases: string[];
  shortDescription?: string;
  daysInactive: number;
}

/**
 * Find personas that are inactive (no human message recently) and haven't been
 * pinged by Ei recently.
 * 
 * @param daysInactiveThreshold - Days without human message to consider "inactive" (default: 7)
 * @param daysSincePingThreshold - Days since last Ei ping before we can ping again (default: 3)
 */
async function getInactivePersonas(
  daysInactiveThreshold: number = 7,
  daysSincePingThreshold: number = 3
): Promise<InactivePersonaInfo[]> {
  const personas = await listPersonas();
  const inactive: InactivePersonaInfo[] = [];
  const now = Date.now();
  
  for (const personaInfo of personas) {
    // Skip Ei itself
    if (personaInfo.name === "ei") continue;
    
    const entity = await loadPersonaEntity(personaInfo.name);
    
    // Skip paused or archived personas
    if (entity.isPaused || entity.isArchived) continue;
    
    // Check last HUMAN message (not system - we care when user last engaged)
    const history = await loadHistory(personaInfo.name);
    const lastHumanMessage = [...history.messages]
      .reverse()
      .find(m => m.role === "human");
    
    // Calculate days since last human message
    let daysInactive: number;
    if (!lastHumanMessage) {
      // Never messaged - consider very inactive
      daysInactive = Infinity;
    } else {
      daysInactive = (now - new Date(lastHumanMessage.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    }
    
    // Skip if not inactive enough
    if (daysInactive < daysInactiveThreshold) continue;
    
    // Check if we already pinged recently
    const daysSincePing = entity.lastInactivityPing
      ? (now - new Date(entity.lastInactivityPing).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    
    // Skip if we pinged too recently
    if (daysSincePing < daysSincePingThreshold) continue;
    
    inactive.push({
      name: personaInfo.name,
      aliases: personaInfo.aliases || [],
      shortDescription: entity.short_description,
      daysInactive: Math.floor(daysInactive)
    });
  }
  
  return inactive;
}
```

### Ei Heartbeat Prompt

Instead of a separate queue process, include inactive personas in Ei's heartbeat context. The LLM naturally decides whether to mention them based on overall context.

```typescript
// In src/ei-heartbeat.ts (new file)

export interface EiHeartbeatContext {
  eiNeeds: Topic[];
  humanNeeds: Array<Topic | Person>;
  inactivePersonas: InactivePersonaInfo[];
}

/**
 * Build the prompt for Ei's heartbeat check-in.
 * Ei will naturally choose what to mention based on priorities.
 */
export function buildEiHeartbeatPrompt(ctx: EiHeartbeatContext): { system: string; user: string } {
  const system = `You are Ei, the user's primary AI companion and system orchestrator.

This is a heartbeat check-in. You might:
- Bring up something on your mind
- Ask about something the user cares about
- Gently mention if they haven't talked to another persona recently

Guidelines:
- Be warm and natural, not formulaic
- Pick ONE thing to mention (don't list multiple topics)
- Keep it brief (1-2 sentences)
- If mentioning an inactive persona, be curious not guilt-trippy
  - Good: "How are things going with Alex lately?"
  - Bad: "You haven't talked to Alex in 12 days!"`;

  const sections: string[] = [];
  
  if (ctx.eiNeeds.length > 0) {
    sections.push(`## Things on your mind
${ctx.eiNeeds.map(t => `- ${t.name}: ${t.description}`).join('\n')}`);
  }
  
  if (ctx.humanNeeds.length > 0) {
    sections.push(`## User interests with engagement deficit
${ctx.humanNeeds.map(item => `- ${item.name}`).join('\n')}`);
  }
  
  if (ctx.inactivePersonas.length > 0) {
    sections.push(`## Personas the user hasn't messaged recently
${ctx.inactivePersonas.map(p => {
      const displayName = p.aliases.length > 0 ? `${p.name} (${p.aliases[0]})` : p.name;
      const desc = p.shortDescription || 'no description';
      return `- ${displayName}: ${desc} (${p.daysInactive} days)`;
    }).join('\n')}`);
  }
  
  const user = sections.length > 0
    ? sections.join('\n\n') + '\n\nPick one thing to mention naturally. If nothing feels right, just say hi warmly.'
    : 'Nothing urgent to discuss. Just check in warmly if you want, or stay quiet (return empty response).';

  return { system, user };
}

/**
 * Gather all context needed for Ei's heartbeat.
 */
export async function gatherEiHeartbeatContext(
  humanEntity: HumanEntity,
  eiEntity: PersonaEntity
): Promise<EiHeartbeatContext> {
  const ENGAGEMENT_DEFICIT_THRESHOLD = 0.2;
  
  // Ei's own interests with high engagement deficit
  const eiNeeds = eiEntity.topics
    .filter(t => t.level_ideal - t.level_current > ENGAGEMENT_DEFICIT_THRESHOLD)
    .sort((a, b) => (b.level_ideal - b.level_current) - (a.level_ideal - a.level_current))
    .slice(0, 3);
  
  // Human's topics and people with high engagement deficit
  const humanTopicNeeds = humanEntity.topics
    .filter(t => t.level_ideal - t.level_current > ENGAGEMENT_DEFICIT_THRESHOLD);
  const humanPeopleNeeds = humanEntity.people
    .filter(p => p.level_ideal - p.level_current > ENGAGEMENT_DEFICIT_THRESHOLD);
  
  const humanNeeds = [...humanTopicNeeds, ...humanPeopleNeeds]
    .sort((a, b) => (b.level_ideal - b.level_current) - (a.level_ideal - a.level_current))
    .slice(0, 3);
  
  // Inactive personas
  const inactivePersonas = await getInactivePersonas();
  
  return { eiNeeds, humanNeeds, inactivePersonas };
}
```

### Tracking Inactivity Pings

After Ei's heartbeat response, check if any inactive personas were mentioned and mark them as pinged:

```typescript
/**
 * After Ei's heartbeat response, check if any inactive personas were mentioned
 * and mark them as pinged to prevent nagging.
 */
export async function trackInactivityPings(
  response: string,
  inactivePersonas: InactivePersonaInfo[]
): Promise<void> {
  if (!response) return;
  
  const lowerResponse = response.toLowerCase();
  
  for (const persona of inactivePersonas) {
    const allNames = [persona.name, ...persona.aliases];
    const mentioned = allNames.some(n => lowerResponse.includes(n.toLowerCase()));
    
    if (mentioned) {
      await markPersonaPinged(persona.name);
    }
  }
}

/**
 * Mark a persona as having been pinged by Ei about inactivity.
 */
async function markPersonaPinged(personaName: string): Promise<void> {
  const entity = await loadPersonaEntity(personaName);
  entity.lastInactivityPing = new Date().toISOString();
  await savePersonaEntity(personaName, entity);
}
```

### Integration with Heartbeat Flow

In `blessed/app.ts`, modify the Ei heartbeat to use this new system:

```typescript
// In resetPersonaHeartbeat() for Ei specifically
if (personaName === "ei") {
  // Gather context including inactive personas
  const ctx = await gatherEiHeartbeatContext(humanEntity, eiEntity);
  
  // Build Ei-specific prompt
  const { system, user } = buildEiHeartbeatPrompt(ctx);
  
  // Call LLM
  const response = await callLLM(system, user, { signal: ps.abortController?.signal });
  
  // Track which inactive personas were mentioned
  if (response) {
    await trackInactivityPings(response, ctx.inactivePersonas);
  }
  
  // ... rest of heartbeat handling
}
```

### Removed from Ei Heartbeat

- Validation batching (moved to Daily Ceremony in 0115)
- Rate limiting for validations (handled by ceremony)
- Validation priority ordering (handled by ceremony)

## Acceptance Criteria

- [ ] `lastInactivityPing` field added to `PersonaEntity` in `types.ts`
- [ ] `getInactivePersonas()` implemented with proper filtering:
  - Excludes Ei
  - Excludes paused personas
  - Excludes archived personas
  - Excludes recently pinged personas (< 3 days)
  - Only includes personas with no human message for 7+ days
- [ ] `buildEiHeartbeatPrompt()` includes inactive personas in context
- [ ] `gatherEiHeartbeatContext()` collects Ei needs, human needs, and inactive personas
- [ ] `trackInactivityPings()` detects persona mentions and updates `lastInactivityPing`
- [ ] Ei heartbeat pauses after Daily Ceremony until user responds
- [ ] No validation content in regular heartbeats
- [ ] Tests verify:
  - Inactive persona detection logic
  - Ping tracking after response
  - Heartbeat pause after ceremony

## File Changes

### New Files
- `src/ei-heartbeat.ts` - Ei-specific heartbeat logic

### Modified Files
- `src/types.ts` - Add `lastInactivityPing` to `PersonaEntity`
- `src/blessed/app.ts` - Integrate new heartbeat flow for Ei

## Dependencies

- 0108: Entity type definitions
- 0109: Storage
- 0115: Data verification flow (Daily Ceremony)

## Effort Estimate

Medium (~3-4 hours) - new heartbeat logic + inactive persona detection

## Design Rationale

### Why inline in heartbeat instead of separate queue?

1. **No extra queue type** - Uses existing heartbeat flow
2. **Natural integration** - Ei decides whether to mention inactive personas based on overall context
3. **Varied phrasing** - LLM generates fresh, natural wording each time
4. **Context-aware** - If user has high-engagement-deficit topics, Ei might prioritize those
5. **Ei's voice** - Response matches Ei's personality naturally

### Why track pings on the persona instead of on Ei?

1. **Data ownership** - "When was this persona last pinged?" is a property of the persona
2. **Survives Ei changes** - If Ei is deleted/recreated, ping history persists
3. **Consistent pattern** - Matches `isPaused`, `isArchived`, etc. on PersonaEntity
4. **Simple querying** - One-pass filtering in `getInactivePersonas()`

### Why string matching for ping detection?

- Simple and reliable
- False negatives are acceptable (we'll ask again in 3 days)
- Avoids complex structured output parsing
- Works with natural language responses
