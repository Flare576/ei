# 0134: Three-Step Human Extraction Flow

**Status**: PENDING

## Problem

Current two-phase extraction (fast-scan + detail update) has issues:

1. **Bias from known items**: Showing 20+ existing topics biases model toward "finding" them
2. **mentioned vs new_items confusion**: Model puts findings in wrong bucket
3. **Naming inconsistency**: "Legal Name" vs "Name" vs "Full Name" unpredictably
4. **Over-extraction**: Model finds things that aren't really there

**Root cause**: The fast-scan prompt asks "what was mentioned from this list AND what's new?" - two different tasks with conflicting goals in one prompt.

## Solution

Replace two-phase with three-step flow:

```
Step 1: "What DPs exist in this text?"
    - BLIND scan (no prior data shown)
    - Single goal: find data points
    - Returns: list of {type, name, value, confidence, reason}
        ↓
Step 2: "Does this DP match something we know?"
    - One call per DP from Step 1
    - Shows existing items of that type
    - Returns: {matched_name, confidence} or "Not Found"
        ↓
Step 3: "Update/create this DP"
    - One call per DP
    - If matched: shows existing data, asks for updates
    - If new: asks to create
    - Returns: full DP object or {} if no changes
```

**Key insight**: Step 1 runs "blind" without the baggage of existing DPs.

## Field Name Mapping

To help models understand field semantics, map code names to prompt names:

| Code (types.ts) | Prompt | Rationale |
|-----------------|--------|-----------|
| `level_current` | `exposure_current` | How recently/much exposed |
| `level_ideal` | `exposure_desired` | How much they want to discuss |

Mapping happens at:
- **Prompt generation**: `level_current` → `exposure_current`
- **Response parsing**: `exposure_current` → `level_current`

## Implementation

### 1. Step 1 Prompts (Blind Scan)

Create per-type prompts based on `tests/model/prompts/step1/`:

```typescript
// src/prompts/extraction/step1/facts.ts
export function buildStep1FactsPrompt(messages: Message[], persona: string): {
  system: string;
  user: string;
} {
  // Use content from tests/model/prompts/step1/facts_system_01.md
  // User prompt: just the conversation, no known items
}
```

Similar for `traits.ts`, `topics.ts`, `people.ts`.

**Output format** (consistent across types):
```json
{
  "facts": [
    {
      "type_of_fact": "Birthday",
      "value_of_fact": "May 26th, 1984",
      "confidence": "high",
      "reason": "User stated 'My birthday is May 26th, 1984'"
    }
  ]
}
```

### 2. Step 2 Prompts (Match)

Create single matching prompt based on `tests/model/prompts/step2/`:

```typescript
// src/prompts/extraction/step2/match.ts
export function buildStep2MatchPrompt(
  dpType: "fact" | "trait" | "topic" | "person",
  dpName: string,
  dpValue: string,
  existingItems: Array<{ name: string; description: string }>
): { system: string; user: string } {
  // Use content from tests/model/prompts/step2/system_01.md
  // Replace [FACT|TRAIT|PERSON|TOPIC] with actual type
}
```

**Output format**:
```json
{
  "name": "Birthday",
  "description": "May 26th, 1984",
  "confidence": "high"
}
// OR
{
  "name": "Not Found",
  "description": "Not Found",
  "confidence": "high"
}
```

### 3. Step 3 Prompts (Update/Create)

Create update prompt based on `tests/model/prompts/step3/`:

```typescript
// src/prompts/extraction/step3/update.ts
export function buildStep3UpdatePrompt(
  dpType: "fact" | "trait" | "topic" | "person",
  currentData: DataItemBase | null,  // null if new
  messages: Message[],
  persona: string
): { system: string; user: string } {
  // Use content from tests/model/prompts/step3/system_01.md
  // Map level_* to exposure_* in currentData display
  // Include conditional field sections based on dpType
}
```

**Output format** (with field mapping):
```json
{
  "name": "Goats",
  "description": "User loves goats, especially pygmy goats",
  "sentiment": 0.8,
  "exposure_current": 0.7,
  "exposure_desired": 0.6,
  "exposure_impact": "medium"
}
// OR
{}  // No changes needed
```

### 4. Orchestration Function

Replace `runFastScan()` with new flow:

```typescript
// src/extraction.ts
export async function runThreeStepExtraction(
  target: "human",  // Only for human data initially
  persona: string,
  messages: Message[],
  dataTypes: Array<"fact" | "trait" | "topic" | "person">,
  signal?: AbortSignal
): Promise<void> {
  for (const dataType of dataTypes) {
    // Step 1: Blind scan
    const step1Result = await callLLMForJSON(
      buildStep1Prompt(dataType, messages, persona)
    );
    
    if (!step1Result?.items?.length) continue;
    
    // Load existing items for matching
    const entity = await loadHumanEntity();
    const existingItems = getItemsOfType(entity, dataType);
    
    for (const item of step1Result.items) {
      // Step 2: Match
      const step2Result = await callLLMForJSON(
        buildStep2MatchPrompt(dataType, item.name, item.value, existingItems)
      );
      
      const isNew = step2Result?.name === "Not Found";
      const matchedItem = isNew ? null : findByName(existingItems, step2Result.name);
      
      // Step 3: Update/Create
      const step3Result = await callLLMForJSON(
        buildStep3UpdatePrompt(dataType, matchedItem, messages, persona)
      );
      
      // Empty object = no changes
      if (!step3Result || Object.keys(step3Result).length === 0) continue;
      
      // Map exposure_* back to level_*
      const mapped = mapFieldsFromPrompt(step3Result);
      
      // Save to entity
      await saveDataItem(target, persona, dataType, mapped, isNew);
    }
  }
}
```

### 5. Field Mapping Helpers

```typescript
// src/prompts/extraction/field-mapping.ts

/**
 * Map code field names to prompt-friendly names.
 * Used when building prompts.
 */
export function mapFieldsToPrompt(item: DataItemBase): Record<string, unknown> {
  const result: Record<string, unknown> = { ...item };
  
  if ('level_current' in item) {
    result.exposure_current = item.level_current;
    delete result.level_current;
  }
  if ('level_ideal' in item) {
    result.exposure_desired = item.level_ideal;
    delete result.level_ideal;
  }
  
  return result;
}

/**
 * Map prompt field names back to code names.
 * Used when parsing LLM responses.
 */
export function mapFieldsFromPrompt(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  
  if ('exposure_current' in data) {
    result.level_current = data.exposure_current;
    delete result.exposure_current;
  }
  if ('exposure_desired' in data) {
    result.level_ideal = data.exposure_desired;
    delete result.exposure_desired;
  }
  
  // Handle exposure_impact (new field for decay calculation)
  // This stays as-is or gets processed separately
  
  return result;
}
```

### 6. Extraction Frequency Integration

Current extraction frequency controller decides when to run extraction. Update to use new flow:

```typescript
// In extraction-frequency.ts or wherever extraction is triggered
if (shouldRunExtraction(target, persona, dataType)) {
  await runThreeStepExtraction(target, persona, messages, [dataType], signal);
}
```

## Migration Strategy

1. **Create new prompts** in `src/prompts/extraction/` folder
2. **Create new orchestration** function alongside existing `runFastScan()`
3. **Feature flag** (env var) to switch between old and new flows
4. **Test with benchmarks** using `tests/model/` framework
5. **Remove old flow** once validated

```typescript
const useNewExtraction = process.env.EI_THREE_STEP_EXTRACTION === "true";

if (useNewExtraction) {
  await runThreeStepExtraction(...);
} else {
  await runFastScan(...);
}
```

## Acceptance Criteria

- [ ] Create Step 1 prompts for facts, traits, topics, people
- [ ] Create Step 2 matching prompt (generic, type-parameterized)
- [ ] Create Step 3 update prompt (type-aware, with conditional fields)
- [ ] Implement field mapping helpers (`level_*` ↔ `exposure_*`)
- [ ] Implement `runThreeStepExtraction()` orchestration
- [ ] Integrate with extraction frequency controller
- [ ] Add feature flag for gradual rollout
- [ ] Benchmark: Compare accuracy vs. old flow using `tests/model/` framework
- [ ] Manual test: Extract facts from test conversation, verify accuracy

## Testing

### Unit Tests
- Field mapping functions (bidirectional)
- Prompt builders (verify output structure)

### Benchmark Tests
Using `tests/model/llm-bench.ts`:
1. Run same conversation through old and new flows
2. Compare extracted data quality
3. Measure hallucination rate (extra items not in conversation)

### Manual Tests
1. Fresh human entity, have conversation mentioning birthday
2. Verify fact extracted correctly
3. Have follow-up conversation mentioning same birthday differently
4. Verify matched to existing fact, not created as duplicate

## Dependencies

- 0133 (Native Message Format) should complete first to avoid rework on prompt structure
- Prompts folder structure from 0135 is helpful but not blocking

## Files Changed

| File | Changes |
|------|---------|
| `src/prompts/extraction/step1/*.ts` | New Step 1 prompts |
| `src/prompts/extraction/step2/match.ts` | New Step 2 prompt |
| `src/prompts/extraction/step3/update.ts` | New Step 3 prompt |
| `src/prompts/extraction/field-mapping.ts` | Field name mapping |
| `src/extraction.ts` | Add `runThreeStepExtraction()`, feature flag |

## Notes

- Test prompts in `tests/model/prompts/step1/`, `step2/`, `step3/` are the source of truth
- This ticket is for **human data extraction only**
- Persona extraction (traits, topics) is handled separately in 0136, 0137
- `exposure_impact` is a new field for decay calculation - handled in Step 3
