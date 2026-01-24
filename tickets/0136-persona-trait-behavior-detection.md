# 0136: Persona Trait Behavior Change Detection

**Status**: PENDING

## Overview

This ticket absorbs and supersedes **0128: Persona Trait Change Detection Overhaul**.

The core insight from 0128 remains: persona traits should only change when the **user explicitly requests a behavior change**, not through organic extraction like human traits.

## Problem

Current extraction treats persona traits like human traits:
- Scans conversation for "mentioned" traits
- Creates/updates traits based on conversation content
- Results in trait corruption (pirate content bleeding into everything)

**What should happen**:
- "Can you use emoji?" → Creates `emoji_usage` trait
- "Be more concise" → Creates `concise_responses` trait  
- "Pirates say arrr" → NO trait change (discussion, not request)

## Solution: Three-Tier Behavior Change Detection

Use prompts from `tests/model/prompts/personaTrait/`:

```
Tier 1: "Does this message request a behavior change?"
    - Human messages only (persona can't request its own changes)
    - Returns: {has_request: boolean, confidence: string}
    - NO → EXIT (most messages)
        ↓
Tier 2: "What behavior is being requested?"
    - Returns: {behavior_name, current_state, requested_change}
        ↓
Tier 3: "How should this trait be represented?"
    - Shows existing traits for context
    - Returns: full trait object or {} if no change needed
```

## Implementation

### 1. Tier 1 Prompt (Gate)

```typescript
// src/prompts/persona/traits.ts

export function buildBehaviorChangeGatePrompt(
  humanMessages: Message[],
  personaName: string
): { system: string; user: string } {
  const system = `You are detecting if the HUMAN USER is requesting a behavior change from the AI PERSONA "${personaName}".

Your ONLY job is to detect EXPLICIT requests for the persona to behave differently.

## Examples of YES (behavior change request):
- "Can you use emoji once in a while?"
- "Be more concise"
- "Stop agreeing with everything"
- "Try speaking like a pirate"
- "Maybe don't say 'actually' so much"

## Examples of NO (not a behavior request):
- "Pirates say arrr" (discussion, not request)
- "I like verbose explanations" (human preference about themselves)
- "You're great at finding bugs" (observation, not request)
- "My cat is a system admin" (story, not request)

Return JSON:
{
  "has_request": true|false,
  "confidence": "high"|"medium"|"low",
  "reason": "Brief explanation"
}`;

  const user = humanMessages.map(m => m.content).join("\n\n");
  
  return { system, user };
}
```

### 2. Tier 2 Prompt (Extraction)

```typescript
export function buildBehaviorExtractionPrompt(
  humanMessages: Message[],
  gateResult: { has_request: boolean; confidence: string; reason: string }
): { system: string; user: string } {
  const system = `Extract the specific behavior being requested.

The user's message was flagged as containing a behavior change request.
Reason: ${gateResult.reason}

Your task: Identify exactly what behavior is being requested.

Return JSON:
{
  "behavior_name": "Short name for the behavior (e.g., 'emoji usage', 'response length')",
  "current_state": "What the current behavior is, if mentioned or implied",
  "requested_change": "What the user wants to change"
}`;

  const user = humanMessages.map(m => m.content).join("\n\n");
  
  return { system, user };
}
```

### 3. Tier 3 Prompt (Mapping)

Based on `tests/model/prompts/personaTrait/system_01.md`:

```typescript
export function buildBehaviorToTraitPrompt(
  behaviorDetails: { behavior_name: string; current_state: string; requested_change: string },
  existingTraits: Trait[],
  personaName: string
): { system: string; user: string } {
  const system = `Map this behavior request to a persona trait for "${personaName}".

# Behavior Request
- Name: ${behaviorDetails.behavior_name}
- Current state: ${behaviorDetails.current_state || "Unknown"}
- Requested change: ${behaviorDetails.requested_change}

# Current Traits
${JSON.stringify(existingTraits, null, 2)}

# Task
Convert this behavior request into a trait. Determine if this is:
- A NEW trait (no existing trait covers this behavior)
- An UPDATE to an existing trait (modify name, description, or strength)

# Fields
- name: Short identifier for the trait
- description: What this trait means, how to exhibit it
- sentiment: How the persona feels about having this trait (-1.0 to 1.0)
- strength: How strongly to apply this (0.0 to 1.0)
  - 0.0 = STOP doing this (user said "stop", "don't", etc.)
  - 0.5 = Default for new behaviors
  - 1.0 = ALWAYS do this (user said "always", "every time", etc.)

# Examples
- "Use emoji sometimes" → strength: 0.3
- "Always be concise" → strength: 0.9
- "Stop saying 'actually'" → strength: 0.0 (disable the trait)

Return JSON:
{
  "name": "...",
  "description": "...",
  "sentiment": 0.5,
  "strength": 0.5,
  "is_new": true|false,
  "replaces_trait": "name of existing trait if updating, null if new"
}

If the behavior request doesn't make sense or is too vague, return: {}`;

  const user = `Convert the behavior request to a trait.`;
  
  return { system, user };
}
```

### 4. Orchestration Function

```typescript
// src/extraction.ts (or new file src/persona-extraction.ts)

export async function detectPersonaBehaviorChange(
  persona: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<void> {
  // Filter to human messages only
  const humanMessages = messages.filter(m => m.role === "human");
  if (humanMessages.length === 0) return;
  
  // Tier 1: Gate
  const tier1Result = await callLLMForJSON<{
    has_request: boolean;
    confidence: string;
    reason: string;
  }>(
    ...buildBehaviorChangeGatePrompt(humanMessages, persona),
    { signal, temperature: 0.3, operation: "concept" }
  );
  
  if (!tier1Result?.has_request) {
    appendDebugLog(`[PersonaTrait] No behavior change request detected for ${persona}`);
    return;
  }
  
  appendDebugLog(`[PersonaTrait] Behavior change detected (${tier1Result.confidence}): ${tier1Result.reason}`);
  
  // Tier 2: Extract
  const tier2Result = await callLLMForJSON<{
    behavior_name: string;
    current_state: string;
    requested_change: string;
  }>(
    ...buildBehaviorExtractionPrompt(humanMessages, tier1Result),
    { signal, temperature: 0.3, operation: "concept" }
  );
  
  if (!tier2Result?.behavior_name) {
    appendDebugLog(`[PersonaTrait] Failed to extract behavior details`);
    return;
  }
  
  // Load existing traits
  const personaEntity = await loadPersonaEntity(persona);
  
  // Tier 3: Map to trait
  const tier3Result = await callLLMForJSON<{
    name: string;
    description: string;
    sentiment: number;
    strength: number;
    is_new: boolean;
    replaces_trait: string | null;
  }>(
    ...buildBehaviorToTraitPrompt(tier2Result, personaEntity.traits, persona),
    { signal, temperature: 0.3, operation: "concept" }
  );
  
  if (!tier3Result || Object.keys(tier3Result).length === 0) {
    appendDebugLog(`[PersonaTrait] No trait change needed`);
    return;
  }
  
  // Apply trait change
  await applyPersonaTraitChange(persona, personaEntity, tier3Result);
}

async function applyPersonaTraitChange(
  persona: string,
  entity: PersonaEntity,
  traitResult: {
    name: string;
    description: string;
    sentiment: number;
    strength: number;
    is_new: boolean;
    replaces_trait: string | null;
  }
): Promise<void> {
  const newTrait: Trait = {
    name: traitResult.name,
    description: traitResult.description,
    sentiment: traitResult.sentiment,
    strength: traitResult.strength,
    last_updated: new Date().toISOString(),
  };
  
  if (traitResult.replaces_trait) {
    // Update existing trait
    const idx = entity.traits.findIndex(
      t => t.name.toLowerCase() === traitResult.replaces_trait!.toLowerCase()
    );
    if (idx >= 0) {
      entity.traits[idx] = newTrait;
    } else {
      entity.traits.push(newTrait);
    }
  } else {
    // Add new trait
    entity.traits.push(newTrait);
  }
  
  await savePersonaEntity(entity, persona);
  
  // Queue description regeneration
  await enqueueItem({
    type: "description_regen",
    priority: "low",
    payload: { persona }
  });
  
  appendDebugLog(`[PersonaTrait] ${traitResult.is_new ? 'Added' : 'Updated'} trait "${traitResult.name}" for ${persona}`);
}
```

### 5. Integration with Extraction Flow

Disable trait extraction for personas in fast-scan:

```typescript
// In routeFastScanResults() or wherever traits are processed
if (target === "system" && item.type === "trait") {
  appendDebugLog(`[FastScan] Skipping trait for persona - use behavior change detection`);
  continue;
}
```

Call behavior detection after each conversation:

```typescript
// In processor.ts or wherever extraction is triggered
if (target === "system") {
  await detectPersonaBehaviorChange(persona, messages, signal);
}
```

## Acceptance Criteria

- [ ] Create three-tier prompt builders in `src/prompts/persona/traits.ts`
- [ ] Implement `detectPersonaBehaviorChange()` orchestration
- [ ] Skip persona traits in fast-scan flow
- [ ] Integrate behavior detection into conversation processing
- [ ] Test: "Can you use emoji?" → Creates trait
- [ ] Test: "Be more concise" → Creates trait
- [ ] Test: "Pirates say arrr" → NO trait change
- [ ] Test: "Stop using Australian slang" → Sets trait strength to 0.0
- [ ] Test: Existing persona traits not corrupted by conversation content

## Testing

### Manual Tests
1. Create new persona (e.g., "Beta")
2. Have conversation with roleplay content (pirates, cats, etc.)
3. Verify original traits unchanged
4. Send explicit request: "Try speaking like a pirate sometimes"
5. Verify new trait added
6. Send: "Actually, stop with the pirate talk"
7. Verify trait strength set to 0.0

### Benchmark Tests
Run prompts through `tests/model/llm-bench.ts` with behavior detection scenarios.

## Dependencies

- 0135 (Prompt Centralization) - for clean prompt organization
- 0134 (Three-Step Extraction) - should complete first to establish extraction patterns

## Files Changed

| File | Changes |
|------|---------|
| `src/prompts/persona/traits.ts` | New file with three-tier prompts |
| `src/extraction.ts` | Add behavior detection, skip traits for personas |
| `src/processor.ts` | Integrate behavior detection call |

## Related Tickets

- **0128**: Superseded by this ticket (same problem, refined solution)
- **0137**: Persona topic extraction (parallel work)

## Notes

- Only human messages passed to detection (persona can't request its own changes)
- No Ei validation needed (traits are core to persona, not auditable data)
- Tier 1 exits early for most messages (efficient)
- Test prompts in `tests/model/prompts/personaTrait/` are source of truth
