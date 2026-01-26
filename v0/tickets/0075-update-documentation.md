# 0075: Update Documentation for New Concept Schema

**Status**: DONE

## Summary
Update AGENTS.md and any other documentation to reflect the new concept schema with sentiment field, removed elasticity, and clarified field definitions.

## Proposed Changes

### Update AGENTS.md

Add a section explaining the concept schema:

```markdown
## Concept Schema

Each concept tracked by the system has these fields:

### level_current (Exposure)
- Range: 0.0 to 1.0
- Represents how recently/frequently this concept has come up
- Decays toward 0.0 over time (logarithmic - fast in middle, slow at extremes)
- Increases when the concept is discussed

### level_ideal (Discussion Desire)  
- Range: 0.0 to 1.0
- Represents how much the entity WANTS TO TALK about this concept
- NOT the same as how much they like it!
- Changes rarely - only on explicit preference signals
- Example: Someone loves birthday cake but only wants to discuss it once a year

### sentiment (Emotional Valence)
- Range: -1.0 (strongly negative) to 1.0 (strongly positive)
- 0.0 = neutral
- Represents how the entity FEELS about the concept
- Updated based on expressed emotions
- Independent of discussion frequency

### Key Insight
These three dimensions are independent:
- High exposure + low desire + positive sentiment = "I like X but we've talked about it enough"
- Low exposure + high desire + negative sentiment = "I need to vent about X"
- High exposure + high desire + neutral sentiment = "X is a regular topic for us"
```

### Update Code Comments

Ensure types.ts has clear JSDoc comments on each field.

## Acceptance Criteria
- [x] AGENTS.md updated with concept schema explanation
- [x] Clear examples showing field independence
- [x] types.ts has JSDoc comments on all Concept fields
- [x] Any other relevant documentation updated

## Value Statement
**Developer Understanding**: Clear documentation helps future agents (and humans) understand the psychological model behind the system.

## Dependencies
- Should be done after 0070-0074 are complete
- Part of 0069: Concept Schema Overhaul

## Effort Estimate
Small (~1 hour)
- AGENTS.md update: 30 minutes
- Code comments: 15 minutes
- Review: 15 minutes

## Technical Notes
- Keep explanations concise but complete
- Use concrete examples to illustrate concepts
- Focus on the "why" not just the "what"
