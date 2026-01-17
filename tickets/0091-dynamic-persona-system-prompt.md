# 0091: Dynamic Persona System Prompt

**Status**: QA

## Summary

Make `buildResponseSystemPrompt` generate persona-appropriate system prompts instead of hardcoding "You are EI, a conversational companion".

## Problem

Current prompt in `prompts.ts` starts with:

```
You are EI, a conversational companion...
```

This is wrong for:
- Personas with different names (should say "You are Mike" not "You are EI")
- Non-conversational personas (assistants, characters, experts)
- Roleplay personas (shouldn't break character with "conversational companion" framing)

## Proposed Solution

### Option A: Template with persona data

Use the persona's `short_description` and `long_description` to build the prompt:

```typescript
function buildResponseSystemPrompt(
  personaName: string,
  systemConcepts: ConceptMap,
  humanConcepts: ConceptMap,
  recentHistory: Message[] | null
): string {
  const shortDesc = systemConcepts.short_description || "a conversational companion";
  const longDesc = systemConcepts.long_description || "";
  
  return `You are ${personaName}, ${shortDesc}.

${longDesc}

[rest of prompt with concept context, etc.]`;
}
```

### Option B: Fully dynamic prompt generation

Have the LLM generate the system prompt based on persona concepts (more complex, probably overkill).

### Recommendation

Option A - use the descriptions we already have. They exist for this purpose.

## Current State

Need to check:
1. What `buildResponseSystemPrompt` currently looks like
2. What data it receives
3. Where it's called from

## Acceptance Criteria

- [x] System prompt uses persona name, not hardcoded "EI"
- [x] System prompt incorporates `short_description` if available
- [x] System prompt incorporates `long_description` if available
- [x] Falls back gracefully when descriptions are missing
- [x] Works for all persona types (conversational, roleplay, assistant)
- [ ] Tests verify prompt generation with various persona configs

## Dependencies

- None

## Effort Estimate

Small-Medium: 1-2 hours
