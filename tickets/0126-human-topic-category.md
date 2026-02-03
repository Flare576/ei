# 0126: Human Topic Category Field

**Status**: DONE
**Depends on**: 0062, 0065
**Blocked by**: None

## Summary

Add a `category` field to `Human.Topic` to fix incorrect name extraction. Currently, `type_of_topic` (e.g., "Conflict", "Interest", "Goal") is being used as the topic name, when it should be the category. The actual topic name should come from `value_of_topic`.

## Problem

Current extraction produces:
```json
{
  "name": "Conflict",           // Wrong - this is the TYPE
  "description": "The Ring's influence and internal struggle..."
}
```

Should be:
```json
{
  "name": "Ring's Influence",   // Correct - from value_of_topic
  "category": "Conflict",       // New field - from type_of_topic
  "description": "..."
}
```

## Root Cause

In `src/core/orchestrators/human-extraction.ts` lines 145-148:
```typescript
case "topic":
  itemName = (candidate as TopicScanCandidate).type_of_topic;  // WRONG
  itemValue = (candidate as TopicScanCandidate).value_of_topic;
  break;
```

The mapping is backwards. The scan prompt already captures the right data, it's just mapped incorrectly.

## Acceptance Criteria

- [x] `Topic` interface in `src/core/types.ts` has `category?: string` field
- [x] `human-extraction.ts` maps `value_of_topic` → `itemName` and `type_of_topic` → category
- [x] `TopicUpdateResult` in `src/prompts/human/types.ts` includes `category`
- [x] `item-update.ts` prompt template includes category in JSON output for topics
- [x] Handler saves category field when processing topic updates
- [x] Web UI displays category in HumanTopicsTab (as a badge or label)
- [x] CONTRACTS.md updated with category field documentation

## Notes

- Category values from scan: Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project
- Optional field (older topics may not have it)
- Small lift - no new prompts needed, just wiring fixes
- Also cleaned up leftover `topics-detection.ts` and `topics-exploration.ts` files from ticket 0124
