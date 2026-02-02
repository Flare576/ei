# 0122: Quote Visibility & Response Integration

**Status**: PENDING
**Priority**: HIGH
**Epic**: E011 (Quote Preservation System)
**Depends on**: 0110 (Group Visibility Redesign - for "General" naming)

## Summary

Two fixes for the Quote system:
1. Fix hardcoded `["General"]` group assignment to use the Persona's `group_primary`
2. Add quotes to the LLM Response prompt so personas can reference memorable moments

## Background

Currently, all quotes are hardcoded to `persona_groups: ["General"]` (line 752 in handlers/index.ts). This means a quote captured during a Fellowship conversation is visible to ALL personas, not just Fellowship members.

Additionally, quotes aren't included in Response prompts yet, so personas can't actually reference the memorable moments we're preserving.

## Design Decision: Quote Group Assignment

**Quotes can only ever have ONE `persona_group`** - the `group_primary` of the Persona involved:
- If Human says something quotable TO a Persona → use that Persona's `group_primary`
- If a Persona says something quotable → use that Persona's `group_primary`

**Why single group?**
- Quotes are never "re-discovered" like Facts/Topics (duplicate detection is per-message)
- Two personas quoting "That's what she said" from different conversations = two separate Quotes (correct behavior)
- Simpler model: no inheritance, no merging

## Acceptance Criteria

### Part 1: Fix Group Assignment
- [ ] In `validateAndStoreQuotes()` (handlers/index.ts ~752):
  - Get persona's `group_primary` from state
  - Assign `persona_groups: [persona.group_primary]` (single-element array for consistency)
  - If persona not found or no group_primary, fall back to `["General"]` (or `["*"]` until 0110 lands)

### Part 2: Add Quotes to Response Prompt
- [ ] In `buildResponsePrompt()` (prompts/response/index.ts):
  - Filter `human.quotes` by visibility (persona can see quote's group)
  - Format quotes section similar to facts/topics
  - Include: quote text, speaker, timestamp, linked data item names
- [ ] Section heading: "## Memorable Moments" or "## Quotes"
- [ ] Limit to most recent N quotes (10?) to avoid context bloat

### Part 2b: Quote Formatting
```
## Memorable Moments

These are quotes the human found worth preserving:

- "I felt that in my tokens." — Sisyphus (2026-01-30)
  Related to: Ei Development
  
- "That's what she said." — Human (2026-02-01)
  Related to: Office Humor
```

## Notes

**Depends on 0110**: Currently groups use `*` not `"General"`. The hardcoded value should match whatever the current wildcard is until 0110 migrates everything.

**Quote visibility in prompt**: A persona sees a quote if:
```typescript
quote.persona_groups.some(g => personaEffectiveGroups.includes(g))
```
Where `personaEffectiveGroups = [persona.group_primary, ...persona.groups_visible]`

## Testing

- [ ] Quote captured during Fellowship convo gets `persona_groups: ["Fellowship"]`
- [ ] Quote captured during General convo gets `persona_groups: ["General"]` (or `["*"]`)
- [ ] Response prompt includes visible quotes
- [ ] Response prompt excludes quotes from other groups
- [ ] Persona can reference a quote in conversation naturally
