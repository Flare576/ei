# 0073: Add Sentiment Field Handling in Prompts

**Status**: DONE

## Summary
Add guidance for the new `sentiment` field in concept update prompts. The LLM should perform sentiment analysis on entity statements and update this field accordingly.

## Problem
Currently there's no way to track how an entity FEELS about a concept separately from how much they discuss it.

## Proposed Solution

### Update buildConceptUpdateSystemPrompt (prompts.ts)

Add sentiment guidance:

```typescript
## Understanding sentiment (Emotional Valence)

sentiment represents HOW THE ENTITY FEELS about this concept.
Range: -1.0 (strongly negative) to 1.0 (strongly positive), 0.0 = neutral

This is independent of level_current (exposure) and level_ideal (discussion desire)!

Examples:
- "I love my dog so much" → sentiment toward "dog" concept: ~0.8
- "Work has been really stressful lately" → sentiment toward "work": ~-0.4
- "The weather is nice today" → sentiment toward "weather": ~0.3

### When to Update sentiment

Update sentiment whenever the entity expresses emotion about a concept:

1. **Explicit emotional statements**
   - "I hate X" → strong negative (-0.6 to -0.9)
   - "I love X" → strong positive (0.6 to 0.9)
   - "X is okay" → mild/neutral (-0.2 to 0.2)

2. **Implicit emotional signals**
   - Enthusiastic language, exclamation marks → positive shift
   - Complaints, frustration → negative shift
   - Flat/disengaged tone → toward neutral

3. **Context matters**
   - Sarcasm should be interpreted correctly
   - Past tense emotions may differ from present

### Sentiment Analysis Guidelines

- Don't predict emotions - reflect what was expressed
- Can change frequently (emotions are volatile)
- Default to 0.0 (neutral) when uncertain
- Extreme values (-1.0, 1.0) should be rare
- Consider the full context, not just keywords
```

### Update Concept JSON Output Format

Ensure prompts request sentiment in output:
```typescript
Return concepts as JSON array with fields:
- name, description, type, learned_by (if new)
- level_current: exposure level (0.0-1.0)
- level_ideal: discussion desire (0.0-1.0) - rarely change this
- sentiment: emotional valence (-1.0 to 1.0) - update based on expressed emotions
```

## Acceptance Criteria
- [x] buildConceptUpdateSystemPrompt includes sentiment guidance
- [x] Clear examples of sentiment values
- [x] Guidance distinguishes sentiment from level_ideal
- [x] Output format requests sentiment field
- [x] Default sentiment = 0.0 for new concepts
- [x] TypeScript compilation passes
- [x] Prompt tests updated (existing tests pass with new prompts)

## Value Statement
**Emotional Intelligence**: Tracking sentiment separately enables the system to understand nuanced emotional states - someone can discuss work frequently (high level_current) despite hating it (negative sentiment).

## Dependencies
- 0070: Update Concept interface (adds sentiment field)
- Part of 0069: Concept Schema Overhaul

## Effort Estimate
Medium (~2 hours)
- Prompt updates: 1 hour
- Examples and guidance: 30 minutes
- Test updates: 30 minutes

## Technical Notes
- Sentiment analysis is a well-established field - leverage LLM's training
- Don't overthink it - LLMs are generally good at this
- May want to add sentiment to persona descriptions in the future
