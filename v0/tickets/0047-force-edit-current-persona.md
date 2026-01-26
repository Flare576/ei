# 0047: Force Edit Current Persona

**Status**: PENDING

## Summary
Implement `/edit --force` command to aggressively modify the current persona's core traits and concept map through guided prompts.

## Problem
Users may want to significantly modify an existing persona's personality, expertise, or behavior patterns without creating a new persona. Current system doesn't support major persona modifications after creation.

## Proposed Solution
Implement force edit with aggressive persona modification:

```typescript
// Force edit command
/edit --force    // Aggressively edit active persona
/forceEdit       // Alternative command name
```

**Force edit process:**
1. Present current persona description and key concepts
2. Prompt for specific changes (personality, expertise, behavior)
3. Run persona generator with modification instructions
4. Update concept map with new traits and patterns
5. Preserve chat history but allow personality shift

**Modification prompts:**
- "What aspects of this persona should change?"
- "New personality traits or behavior patterns?"
- "Different areas of expertise or interests?"
- "How should their communication style evolve?"

## Acceptance Criteria
- [ ] `/edit --force` initiates aggressive persona modification process
- [ ] `/forceEdit` works as alternative command name
- [ ] Process shows current persona description and key concepts
- [ ] User prompted for specific changes to personality and behavior
- [ ] Persona generator updates core traits based on user input
- [ ] Concept map modified to reflect new personality patterns
- [ ] Chat history preserved but persona can exhibit new behavior
- [ ] Changes take effect immediately in next conversation
- [ ] `/help` command documents force edit syntax and purpose
- [ ] Process validates that significant changes are intended

## Value Statement
Allows users to evolve personas significantly over time without losing conversation history, enabling persona development and adaptation to changing needs.

## Dependencies
- Existing persona creation/modification system
- Concept map update mechanisms

## Effort Estimate
Medium (~3-4 hours)