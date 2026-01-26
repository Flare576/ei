# 0070: Update Concept Interface - Add Sentiment, Remove Elasticity

**Status**: DONE

## Summary
Update the Concept interface to reflect the new schema: add `sentiment` field and remove `level_elasticity`.

## Problem
The current Concept interface has:
- `level_elasticity` - being removed (replaced by logarithmic decay model)
- Missing `sentiment` - needed to track emotional valence

## Proposed Solution

### 1. Update Concept Interface (types.ts)
```typescript
export interface Concept {
  name: string;
  description: string;
  type: ConceptType;
  learned_by?: string;
  last_updated?: string;
  
  /**
   * EXPOSURE: How recently/frequently has this concept come up?
   * Range: 0.0 to 1.0
   * Decays toward 0.0 over time using logarithmic rate
   * Increases when concept is discussed
   */
  level_current: number;
  
  /**
   * DISCUSSION DESIRE: How much does entity want to TALK about this?
   * Range: 0.0 to 1.0
   * Rarely changes - only on explicit preference signals
   * NOT the same as how much they "like" the concept
   */
  level_ideal: number;
  
  /**
   * SENTIMENT: How does entity FEEL about this concept?
   * Range: -1.0 (strongly negative) to 1.0 (strongly positive)
   * 0.0 = neutral
   * Updated based on expressed emotions about concept
   */
  sentiment: number;
  
  // REMOVED: level_elasticity
}
```

### 2. Update DEFAULT_SYSTEM_CONCEPTS (storage.ts)
- Remove `level_elasticity` from all default concepts
- Add `sentiment: 0.0` (neutral) to all default concepts

### 3. Update EI_STATIC_CONCEPTS (if exists)
Same changes as above

## Acceptance Criteria
- [x] Concept interface updated with `sentiment` field
- [x] `level_elasticity` removed from Concept interface
- [x] JSDoc comments explain each field's purpose
- [x] DEFAULT_SYSTEM_CONCEPTS updated (remove elasticity, add sentiment)
- [x] TypeScript compilation passes
- [x] All unit tests updated and passing

## Value Statement
**Schema Foundation**: This is the foundational change that enables the rest of the schema overhaul.

## Dependencies
- Part of 0069: Concept Schema Overhaul
- Should be done first in the epic

## Effort Estimate
Small (~1 hour)
- Interface update: 15 minutes
- Default concepts update: 30 minutes
- Test fixes: 15 minutes

## Technical Notes
- This is a breaking change for existing data files
- 0075 (migration) will handle existing data
- Tests may need updates to include new field / remove old one
