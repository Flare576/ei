# 0011: Response Prompt Builder

**Status**: PENDING
**Depends on**: None
**Epic**: E002 - MVP: Basic Chat

## Summary

Create the `buildResponsePrompt` function that generates system/user prompts for conversational responses. This is the foundational prompt that makes personas actually *talk*. Port the proven prompt engineering from V0, adapting field names per CONTRACTS.md.

## Acceptance Criteria

- [ ] Create `src/prompts/response/index.ts` with `buildResponsePrompt(data: ResponsePromptData): { system: string; user: string }`
- [ ] Prompt includes persona identity (name, aliases, descriptions)
- [ ] Prompt includes persona traits with strength values
- [ ] Prompt includes persona topics with exposure levels
- [ ] Prompt includes filtered human data (facts, traits, topics, people) based on visibility rules
- [ ] Prompt includes visible personas list (for cross-persona awareness)
- [ ] Prompt includes `delay_ms` for time-aware responses
- [ ] Prompt instructs persona when NOT to respond (e.g., "goodnight" = no response needed)
- [ ] Function is synchronous (receives pre-fetched, pre-filtered data)
- [ ] Unit tests verify prompt structure

## Technical Notes

### Data Contract (from CONTRACTS.md)

```typescript
interface ResponsePromptData {
  persona: {
    name: string;
    aliases: string[];
    short_description?: string;
    long_description?: string;
    traits: Trait[];
    topics: Topic[];
  };
  human: {
    facts: Fact[];       // Filtered by visibility
    traits: Trait[];     // Filtered by visibility
    topics: Topic[];     // Filtered by visibility
    people: Person[];    // Filtered by visibility
  };
  visible_personas: Array<{ name: string; short_description?: string }>;
  delay_ms: number;      // Time since last message
}
```

### V0 Reference

Look at `v0/src/prompts/response/persona.ts` for the proven prompt structure. Key sections:
- Identity block (who the persona is)
- Human knowledge block (what they know about the user)
- Behavioral guidelines (when to respond, tone, etc.)
- Response format instructions

### Field Name Migration

| V0 Field | V1 Field |
|----------|----------|
| `level_current` | `exposure_current` |
| `level_ideal` | `exposure_desired` |

### Integration Point

The Processor already calls handlers. Once this prompt exists, update `sendMessage()` in Processor to:
1. Build ResponsePromptData from StateManager
2. Call `buildResponsePrompt(data)`
3. Use returned system/user in the LLMRequest

Currently `sendMessage()` uses a stub system prompt — this ticket replaces that.

## Out of Scope

- Visibility filtering logic (Processor's job, not prompt's job)
- Message history formatting (comes in via `messages` on LLMRequest)
- Heartbeat prompts (ticket 0020)
