# 0081: Schema - Add Model Field to ConceptMap

**Status**: PENDING

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Add optional `model` field to the `ConceptMap` interface, allowing personas to specify their preferred LLM model.

## Problem

The `ConceptMap` interface in `types.ts` has no way to store a persona's preferred model. We need to add this field to the schema before we can implement per-persona model selection.

## Proposed Solution

### Type Change

```typescript
// src/types.ts
export interface ConceptMap {
  entity: "human" | "system";
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;  // NEW: Optional model spec (e.g., "openai:gpt-4o")
  last_updated: string | null;
  concepts: Concept[];
  isPaused?: boolean;
  pauseUntil?: string;
  isArchived?: boolean;
  archivedDate?: string;
}
```

### Migration

No migration needed - field is optional. Existing persona files will work unchanged; the absence of `model` means "use global default."

### Documentation Update

Add to AGENTS.md Concept Schema section:

```markdown
#### model (Optional - System entities only)
- **Type**: string (format: `provider:model` or just `model`)
- **Purpose**: Specifies which LLM model this persona should use for responses
- **Default**: Falls back to `EI_LLM_MODEL` environment variable, then `local:google/gemma-3-12b`
- **Examples**: 
  - `"openai:gpt-4o"` - Use OpenAI's GPT-4o
  - `"local:google/gemma-3-12b"` - Use local LM Studio
  - `"google:gemini-1.5-pro"` - Use Google AI Studio
```

## Files Modified

- `src/types.ts` - Add `model?: string` to ConceptMap
- `AGENTS.md` - Document the new field

## Acceptance Criteria

- [ ] `ConceptMap` interface has `model?: string` field
- [ ] TypeScript compilation passes
- [ ] Existing persona files load without error (backward compatible)
- [ ] AGENTS.md documents the `model` field
- [ ] AGENTS.md includes valid provider:model examples

## Dependencies

- None (can be done in parallel with 0080)

## Effort Estimate

Small: 1 hour

## Notes

- The `model` field only makes sense for `entity: "system"` (personas), not for `entity: "human"` (the user's concept map). The human doesn't have a model.
- We could add type validation to reject `model` on human entity, but that's over-engineering. It'll just be ignored.
