# 0074: Update Heartbeat Trigger Logic for New Schema

**Status**: DONE

## Summary
Update the heartbeat conversation trigger logic (`checkConceptDeltas`) to use the new schema fields correctly: trigger when there's a concept the entity wants to discuss but hasn't recently, and sentiment isn't strongly negative.

## Problem
Current trigger (from 0067):
- Checks if `|level_current - level_ideal| > 0.3`
- This conflates "exposure gap" with "desire gap"

With the new schema, we need smarter logic.

## Proposed Solution

### New Trigger Logic

A persona should initiate conversation when:
1. **Discussion desire exceeds recent exposure**: `level_ideal - level_current > threshold`
   - They WANT to talk about something they haven't discussed recently
2. **Sentiment isn't strongly negative**: `sentiment > -0.5`
   - Don't bring up painful topics unprompted
3. **The gap is meaningful**: threshold ~0.3

```typescript
private async checkConceptDeltas(personaName: string): Promise<boolean> {
  const concepts = await loadConceptMap("system", personaName);
  
  const DESIRE_GAP_THRESHOLD = 0.3;
  const SENTIMENT_FLOOR = -0.5; // Don't bring up things they hate
  
  for (const concept of concepts.concepts) {
    // Only trigger if they WANT to discuss MORE than they have been
    const desireGap = concept.level_ideal - concept.level_current;
    
    if (desireGap >= DESIRE_GAP_THRESHOLD && concept.sentiment > SENTIMENT_FLOOR) {
      appendDebugLog(
        `Heartbeat trigger: "${concept.name}" - desire gap ${desireGap.toFixed(2)}, sentiment ${concept.sentiment.toFixed(2)}`
      );
      return true;
    }
  }
  
  return false;
}
```

### Edge Cases

| level_current | level_ideal | sentiment | Trigger? | Reason |
|---------------|-------------|-----------|----------|--------|
| 0.2 | 0.6 | 0.3 | YES | Want to discuss, positive sentiment |
| 0.2 | 0.6 | -0.7 | NO | Want to discuss but painful topic |
| 0.5 | 0.3 | 0.5 | NO | Don't want to discuss (ideal < current) |
| 0.1 | 0.1 | 0.8 | NO | No desire gap despite positive sentiment |

### Constants
```typescript
const DESIRE_GAP_THRESHOLD = 0.3;  // Minimum gap to trigger
const SENTIMENT_FLOOR = -0.5;       // Don't bring up if sentiment below this
```

## Acceptance Criteria
- [x] `checkConceptDeltas` updated for new schema
- [x] Only triggers when level_ideal > level_current (desire gap)
- [x] Respects sentiment floor (doesn't bring up painful topics)
- [x] Clear debug logging explains trigger reason
- [x] Constants are configurable
- [x] TypeScript compilation passes
- [x] Unit tests for trigger logic

## Value Statement
**Emotionally Intelligent Triggers**: Personas will naturally bring up topics the entity wants to discuss, while being sensitive enough not to raise painful subjects unprompted.

## Dependencies
- 0070: Update Concept interface
- 0071: Logarithmic decay model
- Part of 0069: Concept Schema Overhaul

## Effort Estimate
Small-Medium (~1-2 hours)
- Update checkConceptDeltas: 30 minutes
- Edge case handling: 30 minutes
- Tests: 30-60 minutes

## Technical Notes
- The "desire gap" framing is key - it's directional
- Sentiment floor prevents emotional harm
- May want to also consider time since last discussion of painful topics
- Future enhancement: could weight by sentiment (higher sentiment = more likely to trigger)
