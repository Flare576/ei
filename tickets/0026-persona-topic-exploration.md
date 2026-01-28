# 0026: Persona Topic Exploration

**Status**: PENDING
**Depends on**: 0025
**Epic**: E003 - Prompts & Handlers

## Summary

Generate new topics a persona might care about based on their identity, traits, and existing topics. This is the "Explore" phase — creative expansion of what makes this persona interesting. Higher temperature for creativity.

## Acceptance Criteria

- [ ] Create `src/prompts/persona/topics-exploration.ts` with `buildPersonaTopicExplorationPrompt(data): { system: string; user: string }`
- [ ] Prompt includes persona identity (descriptions)
- [ ] Prompt includes current traits
- [ ] Prompt includes current topics
- [ ] Prompt generates 1-3 NEW topics the persona would plausibly care about
- [ ] Generated topics should be interesting and specific, not generic
- [ ] Implement `handlePersonaTopicExploration` handler
- [ ] Handler adds new topics to persona
- [ ] Use higher temperature (0.5-0.7) for creativity
- [ ] Unit tests

## Technical Notes

### Data Contract

```typescript
interface PersonaTopicExplorationPromptData {
  persona_name: string;
  short_description: string;
  long_description: string;
  traits: Trait[];
  current_topics: Topic[];
}

// Expected response - NEW topics only
type PersonaTopicExplorationResult = Array<{
  name: string;
  description: string;
  sentiment: number;
  exposure_current: number;  // Start low (0.3-0.5)
  exposure_desired: number;
}>;
```

### When to Run

From backward doc:
> "I think the idea was that we only execute it if the Persona is 'low' on topics after the Expire step."

Triggered by Ceremony after Expire phase, only if topic count is below threshold (e.g., < 3 topics).

### Creative Guidelines

Prompt should encourage:
- Specific, interesting topics (not "technology" but "retro video game restoration")
- Topics that connect to existing traits
- Topics that would make conversations more engaging
- Varied sentiment (some positive, some neutral)

### Temperature

This is one of the few places we want higher creativity:
```typescript
{ temperature: 0.5, operation: "concept" }
```

### Handler Flow

```
handlePersonaTopicExploration(response, stateManager):
  1. Parse new topics from response.parsed
  2. Filter out any that duplicate existing topics (by name similarity)
  3. Add remaining to persona's topics
  4. Fire onPersonaUpdated
```

### V0 Reference

`v0/src/prompts/persona/topics-exploration.ts`

## Out of Scope

- Determining when to explore (Ceremony's job)
- Human topic exploration (humans explore through conversation)
