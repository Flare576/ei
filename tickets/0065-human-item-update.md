# 0065: Human Item Update (Step 3) Prompt + Handler

**Status**: DONE
**Depends on**: 0064

## Summary

Step 3 of human data extraction: Create or update the matched/new item.

## Acceptance Criteria

- [x] `buildHumanItemUpdatePrompt(data: ItemUpdatePromptData)` implemented
- [x] Works for all data types: fact, trait, topic, person
- [x] Prompt asks LLM to generate/update fields:
  - description, sentiment
  - strength (traits), confidence (facts)
  - exposure_current, exposure_desired (topics, people)
- [x] Returns full item object ready for upsert
- [x] `handleHumanItemUpdate` handler implemented
- [x] Handler applies log function to exposure values (high/medium/low/none -> 0-1)
- [x] Handler sets `learned_by` for new items
- [x] Handler sets `persona_groups` based on persona's group
- [x] If non-Ei persona + General group: Create `ei_validation` queue item

## Notes

**CONTRACTS.md Reference**:
```typescript
interface ItemUpdatePromptData {
  data_type: "fact" | "trait" | "topic" | "person";
  existing_item: DataItemBase | null;
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  new_item_name?: string;
  new_item_value?: string;
}
```

**V1 Backward Reference**:
- "exposure_current needs special handling - high|medium|low|none -> log function"
- "If non-Ei and General group: add ei_validation queue item"

## Implementation

- `src/prompts/human/item-update.ts` - Prompt builder
- `src/prompts/human/types.ts` - Type definitions (ExposureImpact)
- `src/core/handlers/index.ts` - Handler with exposure calculation and validation queueing

## V0 Learnings (Applied 2026-01-31)

V0 had a "poetic embroidery" problem where facts became flowery essays about emotional significance.

**Fixed in V1**:
- Added `confidenceSection` for facts with explicit anti-embroidery guidance
- Tightened generic description guidance: "Be factual and concise"
- Included the exact bad example ("sacred absence shaped by love...") as a DON'T
