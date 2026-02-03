# 0122: Quote Visibility & Response Integration

**Status**: DONE
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
- [x] In `validateAndStoreQuotes()` (handlers/index.ts ~752):
  - Get persona's `group_primary` from state
  - Assign `persona_groups: [persona.group_primary]` (single-element array for consistency)
  - If persona not found or no group_primary, fall back to `["General"]` (or `["*"]` until 0110 lands)

**NOTE**: This was already implemented correctly! The code uses `personaGroup || "General"` where `personaGroup` comes from `persona.group_primary`.

### Part 2: Add Quotes to Response Prompt
- [x] In `buildResponsePrompt()` (prompts/response/index.ts):
  - Filter `human.quotes` by visibility (persona can see quote's group)
  - Format quotes section similar to facts/topics
  - Include: quote text, speaker, timestamp, linked data item names
- [x] Section heading: "## Memorable Moments"
- [x] Limit to most recent 10 quotes to avoid context bloat

### Part 2b: Quote Formatting
```
## Memorable Moments

These are quotes the human found worth preserving:

- "I felt that in my tokens." — Sisyphus (Jan 30, 2026)
  Related to: Ei Development
  
- "That's what she said." — Human (Feb 1, 2026)
  Related to: Office Humor
```

## Implementation Notes

### Files Changed
- `src/prompts/response/types.ts` - Added `quotes: Quote[]` to human data
- `src/prompts/response/sections.ts` - Added `buildQuotesSection()` function
- `src/prompts/response/index.ts` - Included quotes section in both Ei and standard prompts
- `src/core/processor.ts` - Filters quotes by group visibility, limits to 10 most recent
- `CONTRACTS.md` - Updated ResponsePromptData to include quotes

### Visibility Logic
- Ei sees ALL quotes (global visibility)
- Other personas see quotes where `quote.persona_groups` intersects with their effective groups
- Empty `persona_groups` treated as `["General"]` (backward compatibility)

## Testing

- [x] Quote captured during Fellowship convo gets `persona_groups: ["Fellowship"]` (Part 1 was already correct)
- [x] Quote captured during General convo gets `persona_groups: ["General"]`
- [x] Response prompt includes visible quotes
- [x] Response prompt excludes quotes from other groups
- [ ] Persona can reference a quote in conversation naturally (E2E - requires manual testing)
