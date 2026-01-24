# 0128: Persona Trait Change Detection Overhaul

**Status**: SUPERSEDED by 0136

> **Note**: This ticket's problem analysis and solution approach have been absorbed into ticket 0136 (Persona Trait Behavior Detection) as part of the 0132 Extraction System Overhaul epic. The core insights remain valid; 0136 refines the implementation to fit the new prompt architecture.

## Problem Statement

Current persona trait extraction is fundamentally broken:

1. **Wrong question**: Fast-scan asks "was a trait mentioned?" but personas don't "reveal" traits like humans do
2. **Wrong evidence**: LLM cites human messages as evidence for persona traits
3. **Over-aggressive updates**: Every call modifies existing traits/topics (pirate content bleeding into everything)
4. **Wrong model**: Treating persona traits like human traits doesn't match reality

**Evidence from Beta persona testing**:
- Original traits: `Self-Aware Debugging`, `Eager to Break Things`, `Deadpan System Critique`, `Reset-Optimistic`, `Consistent Character`
- After extraction: `pirate_speech`, `feline_system_admin`, `nautical metaphor user`
- `Consistent Character` trait got overwritten with pirate content
- Every topic updated on every call
- LLM started returning YAML instead of JSON during debugging conversation

### Root Cause

Persona traits should only change when **user explicitly requests behavior change**, not through organic extraction. Current flow can't distinguish:
- "I'm a night owl" (human revealing trait about themselves)
- "Can you use emoji?" (human requesting persona behavior change)
- "Pirates say arrr" (conversation content, not a request)

## Solution: Three-Tiered Behavior Change Detection

Replace current fast-scan → detail-update flow for persona traits with a dedicated prompt chain:

```
Human message(s) only (persona responses excluded)
                    ↓
    Tier 1: "Does this message request a behavior change?"
        - NO → EXIT (no trait processing)
        - YES → Continue
                    ↓
    Tier 2: "What behavior is being requested?"
        - Extract: behavior name, current state (if known), requested change
                    ↓
    Tier 3: "How should this trait be represented?"
        - Map to trait format with name, description, strength
        - Determine if NEW trait or UPDATE to existing
```

**Key differences from current approach**:
- Only human messages passed to prompt (persona can't request its own changes)
- Explicit exit at Tier 1 (most messages won't trigger any processing)
- No Ei validation needed (core to persona, not auditable)
- Much more conservative (only explicit requests, not mentions)

## Implementation Details

### New Function: `buildBehaviorChangePrompt()`

Create three-tiered prompt chain in `src/extraction.ts`:

**Tier 1 Prompt** (Gate):
```
System: You are detecting if the HUMAN USER is requesting a behavior change 
from the AI PERSONA.

User: [human messages only]

Task: Does this message contain an EXPLICIT request for the persona to 
behave differently?

Examples of YES:
- "Can you use emoji once in a while?"
- "Be more concise"
- "Stop agreeing with everything"
- "Try speaking like a pirate"

Examples of NO:
- "Pirates say arrr" (discussion, not request)
- "I like verbose explanations" (human preference, not persona request)
- "You're great at finding bugs" (observation, not request)

Return JSON: {"has_request": true/false, "confidence": "high"|"medium"|"low"}
```

**Tier 2 Prompt** (Extraction):
```
System: Extract the specific behavior being requested.

User: [human message + tier 1 result]

Task: What behavior is the user asking to change?

Return JSON:
{
  "behavior_name": "...",
  "current_state": "...", // if mentioned or known
  "requested_change": "..." // specific change being asked for
}
```

**Tier 3 Prompt** (Mapping):
```
System: Map this behavior request to a persona trait.

User: [behavior details from tier 2 + existing traits]

Task: Convert this behavior request into a trait representation.

Return JSON:
{
  "name": "...", // trait name (e.g., "emoji_usage", "concise_responses")
  "description": "...", // what this trait means
  "strength": 0.7, // how strongly to apply this
  "is_new": true/false // creating new trait or modifying existing
}
```

### Changes Required

**1. `src/extraction.ts` - Fast-scan modification**:
```typescript
// Skip traits for system entities (like we skip facts/people)
if (target === "system" && item.type === "trait") {
  appendDebugLog(`[FastScan] Skipping trait "${item.name}" for persona (use behavior change detection)`);
  continue;
}
```

**2. `src/extraction.ts` - New behavior change detection**:
```typescript
export async function detectBehaviorChange(
  persona: string,
  messages: Message[], // human messages only
  existingTraits: Trait[],
  signal?: AbortSignal
): Promise<void> {
  // Tier 1: Gate
  // Tier 2: Extract
  // Tier 3: Map
  // Update persona entity with new/modified trait
}
```

**3. `src/extraction.ts` - Update trait detail prompt**:
```typescript
// buildTraitDetailPrompt() should ONLY be called with target="human"
// Add assertion or warning if called with target="system"
function buildTraitDetailPrompt(
  trait: Trait | null,
  itemName: string,
  target: "human" | "system", // Should only be "human" now
  persona: string,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  if (target === "system") {
    throw new Error("Trait detail prompt should not be used for personas - use detectBehaviorChange instead");
  }
  // ... rest of function
}
```

**4. `src/extraction.ts` - Change log debugging**:
```typescript
// In buildChangeEntry() or where change_log is added
if (persona !== "ei" && process.env.DEBUG) {
  const changeEntry = buildChangeEntry(persona, existingItem, validated);
  validated.change_log = [...(existingItem?.change_log || []), changeEntry];
}
```

**5. `src/extraction.ts` - Fix nested change_log bug**:
```typescript
function buildChangeEntry(
  persona: string,
  previousItem: DataItemBase | null,
  newItem: DataItemBase
): ChangeEntry {
  const deltaSize = previousItem 
    ? Math.abs(JSON.stringify(newItem).length - JSON.stringify(previousItem).length)
    : JSON.stringify(newItem).length;
  
  // Create clean copy without nested change_log for diff calculation
  const previousForDiff = previousItem ? { ...previousItem, change_log: undefined } : null;
  
  return {
    date: new Date().toISOString(),
    persona,
    delta_size: deltaSize,
    previous_value: previousForDiff ? JSON.stringify(previousForDiff) : undefined,
  };
}
```

**6. `src/types.ts` - New payload type** (if needed):
```typescript
export interface BehaviorChangePayload {
  persona: string;
  messages: Message[]; // human messages only
}
```

## Acceptance Criteria

- [ ] Create `buildBehaviorChangePrompt()` three-tier prompt chain
- [ ] Implement `detectBehaviorChange()` function
- [ ] Modify fast-scan to skip traits when `target === "system"`
- [ ] Update `buildTraitDetailPrompt()` to throw error if called with `target === "system"`
- [ ] Only write `change_log` to `system.jsonc` when `DEBUG` env var is set
- [ ] Fix nested change_log bug (don't include previous entry's change_log in new entry)
- [ ] Test with Beta persona - original traits should NOT be overwritten by conversation content
- [ ] Test behavior change detection with examples:
  - [ ] "Can you use emoji?" → Creates/updates `emoji_usage` trait
  - [ ] "Be more concise" → Creates/updates `concise_responses` trait
  - [ ] "Pirates say arrr" → NO trait change (exits at Tier 1)
  - [ ] Mixed message: "Use emoji once in a while. Oh, the answer is 'Sometimes'" → Detects behavior request, processes normally

## Examples

**Should trigger trait change**:
- "Can you use some emoji once in a while?" → Tier 1: YES → new trait: `emoji_usage`
- "Be more concise" → Tier 1: YES → new trait: `concise_responses`
- "Stop agreeing with everything I say" → Tier 1: YES → modify existing or new trait
- "Try speaking like a pirate" → Tier 1: YES → new trait: `pirate_speech`

**Should NOT trigger trait change**:
- "Pirates say arrr" → Tier 1: NO → exit (discussion, not request)
- "I like verbose explanations" → Tier 1: NO → exit (human preference, not persona request)
- "Beta is great at finding bugs" → Tier 1: NO → exit (observation, not request)
- "My cat is a system admin" → Tier 1: NO → exit (human's story, not persona request)

## Out of Scope (Future Tickets)

- Trait removal mechanism (user saying "stop using emoji")
- `/trait` command for manual trait management
- Topic extraction improvements for personas (separate but related problem)
- JSON format corruption when discussing code (LLM returns YAML instead)

## Dependencies

None - can be implemented independently.

## Priority

**High** - Current system actively corrupts persona data on every conversation.

## Testing Strategy

1. **Unit tests** for tier-by-tier prompt logic (mock LLM responses)
2. **Integration test** with Beta persona:
   - Start with original traits (`Self-Aware Debugging`, etc.)
   - Send conversation with pirate discussion
   - Verify original traits unchanged
   - Send explicit request: "Try speaking like a pirate"
   - Verify new trait added without corrupting existing ones
3. **E2E test** for mixed message handling (behavior request + normal conversation)

## Notes

- Persistence uses existing `traits[]` bucket - storage isn't the problem, detection is
- Beta's original traits show that structured trait format works well for nuanced personalities
- The issue isn't that we have traits for personas, it's that we're extracting them the wrong way
- Consider adding prompt reinforcement for JSON format when in "code discussion" context (separate bug)
