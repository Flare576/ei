# 0001: Auto-Generate Persona Descriptions

**Status**: DONE

## Summary

Automatically generate and maintain short/long descriptions for each persona based on their concept map evolution.

## Problem

When listing personas (`/persona`), users see folder names and aliases but no context about what each persona *is* or *does*. Manually maintaining descriptions is tedious and falls out of sync.

## Proposed Solution

Add `short_description` (10-15 words) and `long_description` (2-3 sentences) fields to persona system.jsonc. Update these via LLM call when persona concepts change meaningfully.

### Implementation Options

1. **Conditional 4th LLM call**: After system concept update, if concepts changed, fire a summarization call
2. **Bundled with concept update**: Add to existing prompt (risk: overloading the call)
3. **Periodic regeneration**: Background task that refreshes descriptions on schedule

Recommendation: Option 1 (conditional call) balances accuracy with efficiency.

### Schema Addition

```typescript
interface ConceptMap {
  entity: "human" | "system";
  aliases?: string[];
  short_description?: string;  // "Technical helper who sees your car problems"
  long_description?: string;   // "Mike is a mechanically-inclined friend who..."
  last_updated: string | null;
  concepts: Concept[];
}
```

## Acceptance Criteria

- [x] `/persona` displays short_description next to each persona name
- [x] Descriptions auto-update when persona system concepts change
- [x] New personas get initial description during creation flow
- [x] Descriptions reflect the persona's actual behavioral tendencies

## Value Statement

Users can quickly understand what each persona offers without switching to it or reading raw concept data. Reduces friction in multi-persona workflows.

## Dependencies

- Persona system (this ticket blocked until personas ship)
- Concept update flow must signal "concepts changed" cleanly

## Effort Estimate

Small-Medium: ~2-3 hours including prompt tuning
