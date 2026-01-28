# 0064: Human Item Match (Step 2) Prompt + Handler

**Status**: DONE
**Depends on**: 0060, 0061, 0062, 0063

## Summary

Step 2 of human data extraction: Match scanned items against existing data.

## Acceptance Criteria

- [x] `buildHumanItemMatchPrompt(data: ItemMatchPromptData)` implemented
- [x] Works for all data types: fact, trait, topic, person
- [x] Prompt asks LLM if candidate matches any existing item
- [x] Returns: `{ match_id: string | null, confidence: number }`
- [x] `handleHumanItemMatch` handler implemented
- [x] If match found: Chain to Step 3 with existing item
- [x] If no match: Chain to Step 3 with null (create new)

## Notes

**CONTRACTS.md Reference**:
```typescript
interface ItemMatchPromptData {
  data_type: "fact" | "trait" | "topic" | "person";
  item_name: string;
  item_value: string;
  existing_items: Array<{ name: string; description: string }>;
}
```

**V0 Reference**: `v0/src/prompts/extraction/step2/match.ts`

## Implementation

- `src/prompts/human/item-match.ts` - Prompt builder
- `src/prompts/human/types.ts` - Type definitions
- `src/core/handlers/index.ts` - Handler implementation
- `src/core/orchestrators/human-extraction.ts` - Fetches existing items from HumanEntity
