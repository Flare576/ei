# 0065: Human Item Update (Step 3) Prompt + Handler

**Status**: PENDING
**Depends on**: 0064

## Summary

Step 3 of human data extraction: Create or update the matched/new item.

## Acceptance Criteria

- [ ] `buildHumanItemUpdatePrompt(data: ItemUpdatePromptData)` implemented
- [ ] Works for all data types: fact, trait, topic, person
- [ ] Prompt asks LLM to generate/update fields:
  - description, sentiment
  - strength (traits), confidence (facts)
  - exposure_current, exposure_desired (topics, people)
- [ ] Returns full item object ready for upsert
- [ ] `handleHumanItemUpdate` handler implemented
- [ ] Handler applies log function to exposure values (high/medium/low/none → 0-1)
- [ ] Handler sets `learned_by` for new items
- [ ] Handler sets `persona_groups` based on persona's group
- [ ] If non-Ei persona + General group: Create `ei_validation` queue item

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
- "exposure_current needs special handling - high|medium|low|none → log function"
- "If non-Ei and General group: add ei_validation queue item"
