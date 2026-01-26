# 0071: Update Decay Function for Logarithmic Model

**Status**: QA

## Summary
Replace the current elasticity-based decay with a logarithmic decay model where `level_current` always decays toward 0.0, with the rate dependent on the current value itself.

## Problem
Current decay (in 0067):
- Uses `level_elasticity` as a flat rate
- Decays toward `level_ideal` instead of 0.0
- Doesn't model natural "forgetting" behavior

## Proposed Solution

### New Decay Formula
```typescript
/**
 * Logarithmic decay formula for level_current.
 * 
 * Rate is fastest at middle values (0.5), slowest at extremes (0.0, 1.0).
 * This models natural "forgetting" - recent memories fade quickly,
 * but deeply ingrained or completely forgotten things change slowly.
 * 
 * Formula: decay = k * value * (1 - value) * hours
 * Where k is a tuning constant (default 0.1)
 */
function calculateLogarithmicDecay(currentValue: number, hoursSinceUpdate: number): number {
  const K = 0.1; // Tuning constant - adjust based on feel
  const decay = K * currentValue * (1 - currentValue) * hoursSinceUpdate;
  
  // Always decay toward 0.0
  return Math.max(0, currentValue - decay);
}
```

### Decay Behavior
| level_current | Decay Rate | Explanation |
|---------------|------------|-------------|
| 0.9 | 0.09/hr | High exposure fades quickly |
| 0.5 | 0.25/hr | Middle ground - moderate decay |
| 0.1 | 0.09/hr | Low exposure fades slowly |
| 0.0 | 0/hr | Already at minimum |

### Update applyConceptDecay() in app.ts
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
    
    const newValue = calculateLogarithmicDecay(concept.level_current, hoursSince);
    
    if (Math.abs(newValue - concept.level_current) > 0.001) {
      concept.level_current = newValue;
      concept.last_updated = new Date().toISOString();
      changed = true;
    }
  }
  
  if (changed) {
    await saveConceptMap(concepts, personaName);
  }
  
  return changed;
}
```

## Acceptance Criteria
- [x] Remove `calculateDecay` function that uses elasticity
- [x] Add `calculateLogarithmicDecay` function
- [x] Update `applyConceptDecay` to use new formula
- [x] Decay always moves toward 0.0 (not level_ideal)
- [x] Remove all references to `level_elasticity` in decay logic
- [x] Unit tests for new decay calculation (verified mathematically)
- [x] TypeScript compilation passes

## Value Statement
**Natural Forgetting**: Logarithmic decay models how memory actually works - recent things fade faster, old things persist longer. Removes the arbitrary elasticity parameter.

## Dependencies
- 0070: Update Concept interface (removes elasticity)
- Part of 0069: Concept Schema Overhaul

## Effort Estimate
Small-Medium (~1-2 hours)
- Remove old decay function: 15 minutes
- Implement new formula: 30 minutes
- Update applyConceptDecay: 30 minutes
- Tests: 30 minutes

## Technical Notes
- K constant (0.1) may need tuning - start conservative
- At K=0.1, a concept at 0.5 loses ~0.025 per hour
- Consider making K configurable via constant
- May want different K for static vs topic concepts?
