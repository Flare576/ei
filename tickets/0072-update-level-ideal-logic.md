# 0072: Update level_ideal Adjustment Logic in Prompts

**Status**: QA

## Summary
Update prompts to clarify that `level_ideal` represents "desire to discuss" (not "how much they like it") and should only change on explicit preference signals.

## Problem
Current prompts don't distinguish between:
- How much an entity likes/dislikes something
- How much they want to TALK about something

Example: Someone might love their deceased grandmother but not want to discuss her often. The current system can't model this.

## Proposed Solution

### Update buildConceptUpdateSystemPrompt (prompts.ts)

Add clear guidance section:

```typescript
## Understanding level_ideal (Discussion Desire)

level_ideal represents HOW MUCH THE ENTITY WANTS TO DISCUSS this concept.
This is NOT the same as how much they like or care about it!

Examples:
- Birthday cake: Someone might LOVE it (high sentiment) but only want to discuss 
  it around their birthday (low level_ideal)
- Work stress: Someone might HATE it (negative sentiment) but need to discuss it 
  frequently for support (moderate level_ideal)
- A deceased loved one: Deep positive sentiment, but low discussion desire due to grief

### When to Adjust level_ideal

Adjustments should be RARE. Only change level_ideal when:

1. **Explicit Request**: Entity directly asks to discuss more/less
   - "I don't want to talk about work anymore" → decrease
   - "Tell me more about X" (repeatedly) → slight increase

2. **Sustained Engagement Pattern**: Over multiple messages
   - Entity consistently brings up topic → slight increase
   - Entity consistently changes subject away → slight decrease

3. **Clear Avoidance Signals**: 
   - Short responses when topic comes up → decrease
   - Explicit subject changes → decrease

### How Much to Adjust

Use the intensity/length/frequency of signals:
- Strong explicit request: ±0.2 to ±0.3
- Moderate pattern over time: ±0.1 to ±0.15
- Slight signal: ±0.05

Also apply logarithmic scaling:
- Values near 0.0 or 1.0 are harder to change (extremes are stable)
- Values near 0.5 change more easily
```

### Update buildConceptUpdateUserPrompt

Add reminder:
```typescript
Remember: level_ideal = discussion desire, NOT sentiment.
Only adjust level_ideal for explicit preference signals.
```

## Acceptance Criteria
- [x] buildConceptUpdateSystemPrompt updated with level_ideal guidance
- [x] Clear examples of level_ideal vs sentiment distinction
- [x] Specific triggers for when to adjust level_ideal
- [x] Guidance on adjustment magnitude
- [x] buildConceptUpdateUserPrompt includes reminder
- [x] TypeScript compilation passes
- [x] Existing prompt tests updated if needed

## Value Statement
**Behavioral Clarity**: Clear guidance ensures the LLM makes appropriate adjustments, preventing the system from conflating "likes talking about X" with "likes X."

## Dependencies
- 0070: Update Concept interface
- Part of 0069: Concept Schema Overhaul

## Effort Estimate
Medium (~2 hours)
- Prompt updates: 1 hour
- Examples and edge cases: 30 minutes
- Test updates: 30 minutes

## Technical Notes
- The LLM needs concrete examples to understand the distinction
- Consider adding a few "what NOT to do" examples
- May need to update persona creator prompts similarly
