# 0023: Persona Descriptions Prompt + Handler

**Status**: PENDING
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

When a persona's traits change significantly, their descriptions should be regenerated to stay accurate. This prompt takes current traits/topics and generates updated short/long descriptions.

## Acceptance Criteria

- [ ] Create `src/prompts/generation/descriptions.ts` with `buildPersonaDescriptionsPrompt(data): { system: string; user: string }`
- [ ] Prompt includes persona name and aliases
- [ ] Prompt includes current traits with strengths
- [ ] Prompt includes current topics with exposure levels
- [ ] Prompt generates new short_description (1 sentence)
- [ ] Prompt generates new long_description (2-3 sentences)
- [ ] Implement `handlePersonaDescriptions` handler
- [ ] Handler updates persona entity with new descriptions
- [ ] Handler fires onPersonaUpdated event
- [ ] Unit tests

## Technical Notes

### Data Contract

```typescript
interface PersonaDescriptionsPromptData {
  name: string;
  aliases: string[];
  traits: Trait[];
  topics: Topic[];
}

// Expected LLM response
interface PersonaDescriptionsResult {
  short_description: string;
  long_description: string;
}
```

### When to Trigger

From backward doc:
> "After the Persona Update cycle (Exposure, Decay, Expire, Explore), we should send a very, VERY cautious call to the LLM to see if we should update the long description."

This is triggered by:
1. Ceremony system after trait/topic changes
2. Manual trait editing (future)

The trigger logic lives in Ceremony (0076), not here. This ticket just provides the prompt and handler.

### Cautious Regeneration

The prompt should instruct the LLM to:
- Only change descriptions if traits/topics have significantly diverged
- Preserve the persona's core identity
- Return `{ no_change: true }` if descriptions are still accurate

### Handler Flow

```
handlePersonaDescriptions(response, stateManager):
  1. Parse result from response.parsed
  2. If result.no_change === true, done
  3. Otherwise:
     - stateManager.persona_update(name, {
         short_description: result.short_description,
         long_description: result.long_description,
         last_updated: now
       })
     - Fire onPersonaUpdated
```

### V0 Reference

`v0/src/extraction.ts` — `maybeRegeneratePersonaDescriptions`

## Out of Scope

- Determining WHEN to regenerate (Ceremony's job)
- Comparing old vs new to decide if change is needed (prompt handles this)
