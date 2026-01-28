# 0022: Persona Generation Prompt + Handler

**Status**: PENDING
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

When a user creates a new persona, the LLM generates initial traits and topics based on the user's description. This ticket creates the prompt that transforms "a sarcastic pirate captain" into structured PersonaEntity data.

## Acceptance Criteria

- [ ] Create `src/prompts/generation/persona.ts` with `buildPersonaGenerationPrompt(data): { system: string; user: string }`
- [ ] Prompt takes name and user-provided description
- [ ] Prompt generates 3-5 initial traits with strength values
- [ ] Prompt generates 3-5 initial topics with exposure levels
- [ ] Prompt generates short_description (1 sentence)
- [ ] Prompt generates long_description (2-3 sentences)
- [ ] Expected response is structured JSON
- [ ] Implement `handlePersonaGeneration` handler
- [ ] Handler creates PersonaEntity from response
- [ ] Handler calls `stateManager.persona_add()`
- [ ] Handler fires appropriate events via Processor callback
- [ ] Unit tests verify prompt and handler

## Technical Notes

### Data Contract

```typescript
interface PersonaGenerationPromptData {
  name: string;
  description: string;  // User-provided description
}

// Expected LLM response
interface PersonaGenerationResult {
  short_description: string;
  long_description: string;
  traits: Array<{
    name: string;
    description: string;
    strength: number;      // 0.0-1.0
    sentiment: number;     // -1.0 to 1.0
  }>;
  topics: Array<{
    name: string;
    description: string;
    exposure_current: number;  // Start at 0.5
    exposure_desired: number;  // 0.0-1.0
    sentiment: number;
  }>;
}
```

### Prompt Guidelines

From backward doc:
> "If there are zero Traits/Topics, we generate a few based on the description."
> "The longer the description, the more [Topics] or [Traits] you should add."

Prompt should:
- Scale output to input length
- Generate diverse, interesting traits
- Topics should reflect what the persona would *want* to discuss
- Avoid generic traits like "helpful" or "friendly"

### Handler Flow

```
handlePersonaGeneration(response, stateManager):
  1. Parse PersonaGenerationResult from response.parsed
  2. Build PersonaEntity:
     - entity: "system"
     - aliases: [data.name from request]
     - short_description, long_description from result
     - traits: map result.traits, add id + last_updated
     - topics: map result.topics, add id + last_updated
     - is_paused: false
     - is_archived: false
     - timestamps: now
  3. stateManager.persona_add(name, entity)
  4. Processor fires onPersonaAdded
```

### V0 Reference

`v0/src/persona-creator.ts` — `createPersonaWithLLM`
`v0/src/prompts/generation/persona.ts`

### Integration

`Processor.createPersona()` currently creates a minimal entity directly. After this ticket:
1. createPersona() enqueues generation request
2. Handler creates the full entity
3. Event fires when complete

## Out of Scope

- AI-assist buttons in creator UI (0028)
- Persona image generation (0092)
- User editing generated content before save
