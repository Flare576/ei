# 0111: Fast-Scan Prompt Implementation

**Status**: QA

## Summary

Implement the first phase of the two-phase extraction system. Fast-scan quickly identifies what was discussed in a conversation chunk without doing detailed analysis.

## Design

### Fast-Scan Prompt

**Design Decision**: One prompt covering all four data types. Carefully worded to avoid confusing the LLM into categorizing data - focus on detection, not classification.

```typescript
function buildFastScanSystemPrompt(
  target: "human" | "system",
  knownPersonas: string[]       // To filter out persona/person confusion
): string {
  return `You are scanning a conversation to quickly identify what was discussed.

Your ONLY job is to spot relevant items - do NOT try to categorize or analyze them deeply. Just detect and flag.

Your job is to quickly identify:
1. Which known items were mentioned or relevant
2. Any NEW items that should be tracked long-term

## Known Personas (DO NOT add these as People - they are AI entities)
${knownPersonas.map(p => `- ${p}`).join('\n')}

## Guidelines

**For identifying MENTIONED items:**
- Only flag items that were actually discussed, not just tangentially related
- "high" confidence = explicitly discussed
- "medium" confidence = clearly referenced but not the focus
- "low" confidence = might be relevant, uncertain

**For suggesting NEW items:**
- Be CONSERVATIVE - only suggest genuinely important, long-term relevant items
- Ignore: greetings, small talk, one-off mentions, jokes
- Ignore: roleplay-only content (unless it reveals real information)

**Type hints:**
- fact: Biographical data (birthday, location, job, allergies, etc.)
- trait: Personality patterns, communication style, behavioral tendencies
- topic: Interests, hobbies, subjects they care about discussing
- person: Real people in their life (NOT AI personas)

Return JSON only.`;
}

function buildFastScanUserPrompt(
  target: "human" | "system",
  items: FastScanItem[],
  messages: Message[]
): string {
  const itemList = items.map(i => `- [${i.type}] ${i.name}`).join('\n');
  const messageText = messages.map(m => 
    `[${m.role}]: ${m.content}`
  ).join('\n\n');

  return `## Known Items
${itemList || '(none yet)'}

## Conversation
${messageText}

## Task
Identify mentioned items and suggest new ones.

Return JSON:
{
  "mentioned": [
    { "name": "...", "type": "fact|trait|topic|person", "confidence": "high|medium|low" }
  ],
  "new_items": [
    { "name": "...", "type": "fact|trait|topic|person", "confidence": "high|medium|low", "reason": "..." }
  ]
}`;
}

interface FastScanItem {
  name: string;
  type: "fact" | "trait" | "topic" | "person";
}

interface FastScanResult {
  mentioned: Array<{
    name: string;
    type: "fact" | "trait" | "topic" | "person";
    confidence: "high" | "medium" | "low";
  }>;
  new_items: Array<{
    name: string;
    type: "fact" | "trait" | "topic" | "person";
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
}
```

### Processing Logic

```typescript
async function runFastScan(
  target: "human" | "system",
  persona: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<FastScanResult | null> {
  // 1. Load current entity to get item names
  const entity = target === "human" 
    ? await loadHumanEntity()
    : await loadPersonaEntity(persona);
  
  // 2. Build item list (names + types only, no descriptions)
  const items = extractItemList(entity);
  
  // 3. Get known persona names (to filter)
  const personas = await listPersonas();
  const personaNames = personas.flatMap(p => [p.name, ...p.aliases]);
  
  // 4. Call LLM
  const result = await callLLMForJSON<FastScanResult>(
    buildFastScanSystemPrompt(target, personaNames),
    buildFastScanUserPrompt(target, items, messages),
    { signal, temperature: 0.3, operation: "fast_scan" }
  );
  
  // 5. Filter out any new_items that match persona names (belt + suspenders)
  if (result?.new_items) {
    result.new_items = result.new_items.filter(item => 
      !personaNames.some(p => 
        p.toLowerCase() === item.name.toLowerCase()
      )
    );
  }
  
  return result;
}
```

### Post-Scan Routing

```typescript
async function routeFastScanResults(
  result: FastScanResult,
  target: "human" | "system",
  persona: string,
  messages: Message[]
): Promise<void> {
  // High/medium confidence → queue detail updates
  const forDetailUpdate = [
    ...result.mentioned.filter(i => i.confidence !== "low"),
    ...result.new_items.filter(i => i.confidence !== "low")
  ];
  
  for (const item of forDetailUpdate) {
    await enqueueItem({
      type: "detail_update",
      priority: "normal",
      payload: {
        target,
        persona,
        data_type: item.type,
        item_name: item.name,
        messages,
        is_new: result.new_items.some(n => n.name === item.name)
      }
    });
  }
  
  // Low confidence → queue for Ei validation
  const forValidation = [
    ...result.mentioned.filter(i => i.confidence === "low"),
    ...result.new_items.filter(i => i.confidence === "low")
  ];
  
  for (const item of forValidation) {
    await enqueueItem({
      type: "ei_validation",
      priority: "low",
      payload: {
        validation_type: "fact_confirm",
        item_name: item.name,
        data_type: item.type,
        context: `Detected "${item.name}" (${item.type}) with low confidence. ${
          result.new_items.some(n => n.name === item.name) 
            ? `Reason: ${result.new_items.find(n => n.name === item.name)?.reason}`
            : 'Mentioned but unclear if relevant.'
        }`
      }
    });
  }
}
```

## Acceptance Criteria

- [x] buildFastScanSystemPrompt implemented (src/extraction.ts)
- [x] buildFastScanUserPrompt implemented (src/extraction.ts)
- [x] runFastScan function implemented (src/extraction.ts)
- [x] Persona name filtering works (both in prompt AND post-processing)
- [x] Results correctly routed to detail_update or ei_validation queues (routeFastScanResults)
- [x] Tests cover: empty entity, full entity, new items, persona filtering (tests/unit/extraction.test.ts - 10 tests, all passing)

## Dependencies

- 0108: Entity type definitions
- 0109: Storage migration (for loading entities)
- 0110: LLM queue (for enqueueing results)

## Effort Estimate

Medium (~3 hours)

## Implementation Notes (2026-01-20)

Created `src/extraction.ts` (280 lines) with:
- `FastScanItem` and `FastScanResult` types (exported for use in other modules)
- `extractItemList()` - Extracts flat name+type list from HumanEntity or PersonaEntity
- `buildFastScanSystemPrompt()` - Builds system prompt with persona filtering
- `buildFastScanUserPrompt()` - Builds user prompt with known items and messages
- `runFastScan()` - Main execution function, returns FastScanResult or null on failure
- `routeFastScanResults()` - Routes results to detail_update or ei_validation queues

Created `tests/unit/extraction.test.ts` (10 tests, all passing):
- Tests for human and persona entity scanning
- Persona name filtering (case-insensitive)
- LLM failure handling (returns null)
- Routing logic (high/medium → detail_update, low → ei_validation)
- Message payload preservation

### Key Design Decisions

1. **Operation parameter**: Using `operation: "concept"` instead of `"fast_scan"` for LLM calls since LLMOperation type only supports "response" | "concept" | "generation". This maps to EI_MODEL_CONCEPT env var for model selection.

2. **Null return on failure**: runFastScan returns null instead of throwing, making extraction failures non-critical. Caller can decide whether to retry.

3. **Belt + suspenders filtering**: Persona names are filtered both in the system prompt (tells LLM not to add them) AND in post-processing (removes them if LLM ignores us). Case-insensitive matching.

4. **Confidence-based routing**:
   - High/medium confidence → detail_update queue (Phase 2 extraction)
   - Low confidence → ei_validation queue (human verification)
   - This prevents garbage data while still catching uncertain items for review

### Old Code Removed (as part of 0111)

The following old concept-system functions were removed from `src/prompts.ts` as part of this ticket:
- ✅ `MUTABLE_TYPES` constant (line 3)
- ✅ `stripConceptMetaFieldsForLLM()` function (lines 5-14)
- ✅ `formatConceptsByType()` function (lines 84-99)
- ✅ `getHighestNeedConcepts()` function (lines 101-109)
- ✅ `buildConceptUpdateSystemPrompt()` function (lines 306-439, 133 lines)
- ✅ `buildConceptUpdateUserPrompt()` function (lines 441-461, 20 lines)

**Total removed**: ~185 lines of old concept system code

These are replaced by the new extraction system in `src/extraction.ts`.

### Notes for Next Tickets

- **0112 (Detail Update Prompts)**: Will need to import `FastScanResult` type and use payload from queue
- **0113 (Extraction Frequency)**: Will need to call `runFastScan()` and `routeFastScanResults()` based on frequency logic
- **0122 (Cleanup)**: Old concept update prompts already deleted as part of this ticket
