# 0115: Data Verification Flow

**Status**: QA

## Summary

Implement Ei's data verification system. When data points are extracted with low confidence, they queue for Ei's Daily Ceremony where Ei asks the user to confirm.

## Design

### Daily Ceremony

Every day at a configurable time (default 9am), Ei sends a "Daily Confirmations" message:
- Contains up to 5 pending validations
- Some days empty - that's fine, establishes the pattern
- User always knows when/why Ei is asking about data
- Consistent ceremony prevents surprise "how did you know that?" moments

### Verification Triggers

Data points enter verification queue when:
1. **New data extracted** with confidence < 1.0
2. **Cross-persona update** to global data (from 0116)
3. **Explicit request** via `/clarify` command

### Queue Structure

Uses the LLM queue from 0110:
```typescript
interface EiValidationPayload {
  validation_type: "data_confirm" | "cross_persona" | "conflict" | "staleness";
  item_name: string;
  data_type: "fact" | "trait" | "topic" | "person";
  context: string;           // Human-readable explanation
  confidence?: number;       // For data_confirm type
  source_persona?: string;   // For cross_persona type
}
```

**Note**: `validation_type: "data_confirm"` covers all data types (facts, traits, topics, people), not just facts.

### Daily Ceremony Message

```typescript
async function buildDailyCeremonyMessage(): Promise<string | null> {
  const pending = await getPendingValidations();
  
  if (pending.length === 0) {
    return null;  // No ceremony needed today
  }
  
  // Priority order: facts → people → traits → topics
  // Within category: lowest confidence first
  const sorted = pending
    .sort((a, b) => {
      const typeOrder = { fact: 0, person: 1, trait: 2, topic: 3 };
      const aOrder = typeOrder[a.payload.data_type] ?? 4;
      const bOrder = typeOrder[b.payload.data_type] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.payload.confidence || 0) - (b.payload.confidence || 0);
    })
    .slice(0, 5);  // Max 5 per ceremony
  
  const items = sorted.map((v, i) => {
    const p = v.payload as EiValidationPayload;
    const source = p.source_persona && p.source_persona !== "ei" 
      ? ` (from ${p.source_persona})` 
      : "";
    return `${i + 1}. **${p.item_name}**${source}: ${p.context}`;
  }).join('\n');
  
  return `## Daily Confirmations

I've noted a few things from recent conversations. Mind confirming these?

${items}

Just let me know which are correct, need adjusting, or should be removed entirely. If any were just roleplay or jokes, let me know and I'll keep them separate.`;
}
```

### User Response Processing

Parse user's natural language response:

```typescript
interface VerificationResponse {
  confirmed: string[];      // Data point names confirmed correct
  corrected: Array<{
    name: string;
    correction: string;     // What user said instead
  }>;
  rejected: string[];       // Data points to remove
  roleplay: Array<{         // Move to specific group
    name: string;
    group: string;
  }>;
  unclear: string[];        // Need to re-ask
}

async function processVerificationResponse(
  userMessage: string,
  pendingValidations: EiValidationPayload[]
): Promise<VerificationResponse> {
  const prompt = `The user was asked to verify these data points:
${pendingValidations.map(v => `- ${v.item_name} (${v.data_type}): ${v.context}`).join('\n')}

Their response: "${userMessage}"

Parse their response. Return JSON:
{
  "confirmed": ["names they said were correct"],
  "corrected": [{"name": "item", "correction": "what they said instead"}],
  "rejected": ["names they said were wrong/to remove"],
  "roleplay": [{"name": "item", "group": "group name for roleplay context"}],
  "unclear": ["names we still need clarification on"]
}`;

  return await callLLMForJSON<VerificationResponse>(...);
}
```

### Post-Verification Actions

```typescript
async function applyVerificationResults(
  results: VerificationResponse,
  pendingValidations: EiValidationPayload[]
): Promise<void> {
  const entity = await loadHumanEntity();
  
  // Confirmed: boost confidence to 1.0, update last_confirmed
  for (const name of results.confirmed) {
    const item = findDataPointByName(entity, name);
    if (item && 'confidence' in item) {
      item.confidence = 1.0;
      item.last_confirmed = new Date().toISOString();
    }
  }
  
  // Corrected: queue re-extraction with correction context
  for (const { name, correction } of results.corrected) {
    await enqueueItem({
      type: "detail_update",
      priority: "high",
      payload: {
        target: "human",
        persona: "ei",
        data_type: findDataType(entity, name),
        item_name: name,
        messages: [{
          role: "human",
          content: correction,
          timestamp: new Date().toISOString()
        }],
        is_new: false
      }
    });
  }
  
  // Rejected: remove from entity
  for (const name of results.rejected) {
    removeDataPointByName(entity, name);
  }
  
  // Roleplay: move to specified group
  for (const { name, group } of results.roleplay) {
    const item = findDataPointByName(entity, name);
    if (item) {
      item.persona_groups = [group];
    }
  }
  
  await saveHumanEntity(entity);
  
  // Clear processed validations (except unclear ones)
  const processedIds = pendingValidations
    .filter(v => !results.unclear.includes(v.item_name))
    .map(v => v.id);
  await clearValidations(processedIds);
}
```

### Ceremony Scheduling

```typescript
interface CeremonyConfig {
  enabled: boolean;
  time: string;           // "09:00" format
  timezone?: string;      // Default: system timezone
}

async function checkDailyCeremony(): Promise<void> {
  const config = await loadCeremonyConfig();
  if (!config.enabled) return;
  
  const now = new Date();
  const lastCeremony = await getLastCeremonyDate();
  
  // Check if it's a new day and past ceremony time
  if (isNewDay(lastCeremony, now) && isPastCeremonyTime(config.time, now)) {
    const message = await buildDailyCeremonyMessage();
    if (message) {
      await sendEiMessage(message);
    }
    await recordCeremony(now);
  }
}
```

## Staleness Suggestions (Low Priority)

After all facts/traits/people/topics are confirmed, Ei naturally moves into maintenance mode:

```typescript
async function addStalenessChecks(validations: EiValidationPayload[]): Promise<void> {
  // Only add if we have room (< 5 validations already)
  if (validations.length >= 5) return;
  
  const entity = await loadHumanEntity();
  const now = Date.now();
  const SIX_MONTHS = 6 * 30 * 24 * 60 * 60 * 1000;
  
  // Find stale, low-engagement items
  const stale = [
    ...entity.topics.filter(t => 
      t.level_current < 0.2 && 
      (now - new Date(t.last_updated).getTime()) > SIX_MONTHS
    ),
    ...entity.people.filter(p => 
      p.level_current < 0.2 && 
      (now - new Date(p.last_updated).getTime()) > SIX_MONTHS &&
      !PROTECTED_RELATIONSHIPS.includes(p.relationship)  // Never suggest removing family
    )
  ];
  
  const PROTECTED_RELATIONSHIPS = ["daughter", "son", "spouse", "partner", "parent", "sibling"];
  
  // Add up to remaining slots
  const remaining = 5 - validations.length;
  for (const item of stale.slice(0, remaining)) {
    validations.push({
      validation_type: "staleness",
      item_name: item.name,
      data_type: item.type === "topic" ? "topic" : "person",
      context: `We haven't talked about "${item.name}" in over 6 months - should I forget about them?`
    });
  }
}
```

This runs at **lowest priority** - only when there are no other validations pending.

## Acceptance Criteria

- [x] Daily Ceremony runs at configurable time
- [x] Up to 5 validations per ceremony
- [x] Priority: facts → people → traits → topics, then by confidence
- [x] Staleness suggestions added only when slots available
- [x] Protected relationships never suggested for removal
- [x] User responses parsed correctly
- [x] Confirmed data gets confidence boost
- [x] Corrected data gets re-extracted
- [x] Rejected data is removed
- [x] Roleplay data moved to specified group
- [x] Empty ceremony days are fine (no message)
- [x] Ceremony state persists across restarts

## Implementation Notes

**Files Created:**
- `src/verification.ts` - Core Daily Ceremony logic (411 lines)
- `tests/unit/verification.test.ts` - Comprehensive test coverage (14 tests, all passing)

**Files Modified:**
- `src/types.ts` - Added `CeremonyConfig` interface to `HumanEntity`
- `src/storage.ts` - Updated `DEFAULT_HUMAN_ENTITY` with default ceremony config
- `src/prompts.ts` - Added `buildVerificationResponsePrompt()` for centralized prompt management
- `src/llm-queue.ts` - Fixed `fact_confirm` → `data_confirm` validation type, added confidence field
- `src/extraction.ts` - Updated to use `data_confirm` validation type with numeric confidence
- `tests/unit/extraction.test.ts` - Updated test to use `data_confirm`
- `tests/unit/queue-processor.test.ts` - Updated test to use `data_confirm`

**Protected Relationships:**
Comprehensive list of 92 relationship terms that are never suggested for removal, including:
- Immediate family (children, parents, siblings, spouses)
- Step/adoptive/foster family
- In-laws
- Grandparents and grandchildren
- Variations (mom/mother, dad/father, etc.)

**Verification Response Parsing:**
Uses LLM with operation type "concept" to parse natural language responses into structured actions:
- Confirmed items → boost confidence to 1.0, record last_confirmed timestamp
- Corrected items → queue detail_update with correction context
- Rejected items → remove from entity
- Roleplay items → move to specified persona group
- Unclear items → remain in queue for re-asking

**Daily Ceremony Scheduling:**
- Configurable time (default 09:00)
- Tracks last_ceremony timestamp in human.jsonc
- Runs once per day after configured time
- Returns null if no validations pending (no empty messages)

**Integration Points:**
- Reads from LLM queue via `getPendingValidations()`
- Enqueues detail_update for corrections
- Clears processed validations via `clearValidations()`
- Updates human entity via `saveHumanEntity()`

## Dependencies

- 0108: Entity type definitions
- 0109: Storage
- 0110: LLM queue
- 0112: Detail updates (for corrections)

## Effort Estimate

Medium-Large (~4-5 hours)
