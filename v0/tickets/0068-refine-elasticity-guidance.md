# 0068: Refine Elasticity Guidance and Defaults

**Status**: CANCELLED

> **Note**: Superseded by 0069 (Concept Schema Overhaul) which removes elasticity entirely in favor of logarithmic decay model and adds sentiment field.

## Summary
Update prompts and default values to provide clear guidance on how elasticity should be set, now that it has concrete meaning as a decay rate for programmatic concept adjustment.

## Problem
Currently, elasticity is an abstract concept without clear definition:
- LLMs set arbitrary values without understanding implications
- No consistent baseline across personas
- Static concepts in storage.ts have values without explanation
- Users/developers can't predict how elasticity affects behavior

With the new decay system (0067), elasticity now means:
> "Rate of drift toward ideal level, expressed as change per hour"

We need prompts and defaults that reflect this concrete meaning.

## Proposed Solution

### 1. Update Elasticity Documentation
Add clear definition in prompts and comments:

```typescript
// In prompts.ts or types.ts
/**
 * ELASTICITY: Rate of natural drift toward level_ideal, per hour.
 * 
 * Examples:
 * - 0.05 (5%/hr): Very stable trait, barely changes without interaction
 * - 0.1 (10%/hr): Stable core personality aspect
 * - 0.2 (20%/hr): Moderate stability, gradually returns to baseline
 * - 0.4 (40%/hr): Flexible interest, relatively quick to reset
 * - 0.6 (60%/hr): Volatile, changes rapidly with time
 * 
 * Guideline by type:
 * - static: 0.05-0.15 (core values change slowly)
 * - persona: 0.1-0.3 (personality traits are moderately stable)
 * - topic: 0.2-0.5 (interests naturally wax and wane)
 * - person: 0.3-0.6 (relationship intensity fluctuates)
 */
```

### 2. Update Default Static Concepts (storage.ts)
Adjust elasticity values to reflect guidelines:

```typescript
const DEFAULT_SYSTEM_CONCEPTS: ConceptMap = {
  entity: "system",
  aliases: ["default", "core"],
  last_updated: null,
  concepts: [
    {
      name: "Promote Human-to-Human Interaction",
      description: "...",
      level_current: 0.5,
      level_ideal: 0.8,
      level_elasticity: 0.1, // Core value, slow drift
      type: "static",
      last_updated: new Date().toISOString()
    },
    // ... adjust others similarly
  ]
};
```

### 3. Update Concept Update Prompt (prompts.ts)
Add elasticity guidance to LLM instructions:

```typescript
export function buildConceptUpdateSystemPrompt(...) {
  return `...
  
## Elasticity Guidelines
When setting level_elasticity for new concepts:
- static concepts: 0.05-0.15 (core values, very stable)
- persona concepts: 0.1-0.3 (personality traits)
- topic concepts: 0.2-0.5 (interests that naturally fade)
- person concepts: 0.3-0.6 (relationship intensity varies)

Higher elasticity = concept naturally drifts toward ideal faster when not reinforced.
Lower elasticity = concept stays at current level longer without interaction.

...`;
}
```

### 4. Update Persona Creator Prompt
Similar guidance when creating new personas:

```typescript
// In persona-creator.ts
const prompt = `...

For each concept's level_elasticity:
- Use 0.05-0.15 for core personality traits that define who this persona IS
- Use 0.2-0.4 for interests and preferences that can shift over time
- Use 0.4-0.6 for volatile emotional states or situational preferences

...`;
```

### 5. Validation (Optional)
Add soft validation for elasticity ranges:

```typescript
function validateElasticity(concept: Concept): string[] {
  const warnings: string[] = [];
  
  if (concept.level_elasticity < 0.01 || concept.level_elasticity > 1) {
    warnings.push(`${concept.name}: elasticity ${concept.level_elasticity} outside valid range [0.01, 1.0]`);
  }
  
  const expectedRange = ELASTICITY_RANGES[concept.type];
  if (concept.level_elasticity < expectedRange.min || concept.level_elasticity > expectedRange.max) {
    warnings.push(`${concept.name}: elasticity ${concept.level_elasticity} unusual for type ${concept.type} (expected ${expectedRange.min}-${expectedRange.max})`);
  }
  
  return warnings;
}
```

## Acceptance Criteria
- [ ] Clear elasticity definition documented (per-hour drift rate)
- [ ] Default static concepts have appropriate elasticity values
- [ ] Concept update prompt includes elasticity guidelines
- [ ] Persona creator prompt includes elasticity guidelines
- [ ] Example values provided for each concept type
- [ ] Existing tests updated if affected by value changes
- [ ] Optional: soft validation warns about unusual values

## Value Statement
**Predictable Behavior**: Clear elasticity definitions ensure LLMs set meaningful values and developers can predict system behavior. Essential for the decay mechanic to work as intended.

## Dependencies
- 0067: Programmatic Concept Decay (gives elasticity concrete meaning)
- Part of 0061: Concept Processing Architecture Overhaul

## Effort Estimate
Small (~1-2 hours)
- Documentation and comments: 30 minutes
- Default value updates: 20 minutes
- Prompt updates: 30 minutes
- Optional validation: 30 minutes

## Technical Notes
- Elasticity = 0.1 means ~2.4 hour half-life for gap between current and ideal
- Current default values (0.1-0.4) are reasonable but need consistency
- Consider exposing elasticity ranges as constants for easy tuning
- May want to add elasticity to persona descriptions for transparency
