# 0064: Human Item Match (Step 2) Prompt + Handler

**Status**: PENDING
**Depends on**: 0060, 0061, 0062, 0063

## Summary

Step 2 of human data extraction: Match scanned items against existing data.

## Acceptance Criteria

- [ ] `buildHumanItemMatchPrompt(data: ItemMatchPromptData)` implemented
- [ ] Works for all data types: fact, trait, topic, person
- [ ] Prompt asks LLM if candidate matches any existing item
- [ ] Returns: `{ match_id: string | null, confidence: number }`
- [ ] `handleHumanItemMatch` handler implemented
- [ ] If match found: Chain to Step 3 with existing item
- [ ] If no match: Chain to Step 3 with null (create new)

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

**V0 Reference**: `v0/src/prompts/human/itemMatch.ts`
