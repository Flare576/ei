# 0024: Persona Trait Extraction

**Status**: DONE
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

Personas learn traits from user requests like "be more direct" or "stop using so many emojis." This prompt analyzes conversation for explicit behavioral requests and updates the persona's traits accordingly.

## Acceptance Criteria

- [x] Create `src/prompts/persona/traits.ts` with `buildPersonaTraitExtractionPrompt(data): { system: string; user: string }`
- [x] Prompt includes persona's current traits
- [x] Prompt includes recent conversation (context + new messages)
- [x] Prompt detects explicit user requests to change behavior
- [x] Prompt returns updated trait list (add/modify/remove)
- [x] Implement `handlePersonaTraitExtraction` handler
- [x] Handler diffs old vs new traits
- [x] Handler updates persona entity
- [x] Handler may trigger description regeneration (enqueue 0023)
- [ ] Unit tests (deferred to E004)

## Technical Notes

### Data Contract

```typescript
interface PersonaTraitExtractionPromptData {
  persona_name: string;
  current_traits: Trait[];
  messages_context: Message[];   // Earlier messages
  messages_analyze: Message[];   // New messages to analyze
}

// Expected LLM response - complete trait list
type PersonaTraitExtractionResult = Trait[];
```

### What Triggers This

From backward doc:
> "Every human message should trigger... The Persona Trait Check: 'Did the human tell me to act a certain way?'"

So this runs after every human message, not just during Ceremony.

### Detection Guidelines

Prompt should look for:
- Direct requests: "be more concise", "use fewer emojis"
- Indirect feedback: "that was too long", "I liked how you explained that"
- Negative feedback: "stop being so formal", "don't use so much jargon"

Prompt should NOT:
- Infer traits from general conversation
- Add traits the user didn't request
- Remove traits without explicit feedback

### Handler Flow

```
handlePersonaTraitExtraction(response, stateManager):
  1. Parse Trait[] from response.parsed
  2. Get current traits from persona
  3. Diff: added, removed, modified
  4. If no changes, done
  5. Update persona with new traits
  6. If significant changes, enqueue description regeneration
  7. Fire onPersonaUpdated
```

### V0 Reference

`v0/src/extraction.ts` — `runPersonaTraitExtraction`
`v0/src/prompts/persona/traits.ts`

### Integration Point

Processor.sendMessage() should enqueue this after the response request:
```typescript
// After enqueuing response
this.stateManager.queue_enqueue({
  type: LLMRequestType.JSON,
  priority: LLMPriority.Low,
  next_step: LLMNextStep.HandlePersonaTraitExtraction,
  // ... prompts and data
});
```

## Out of Scope

- Human trait extraction (E006)
- Topic extraction (0025)
- Frequency throttling (this runs every message, but is fast/cheap)
