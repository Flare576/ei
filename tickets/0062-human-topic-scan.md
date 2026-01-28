# 0062: Human Topic Scan (Step 1) Prompt + Handler

**Status**: DONE
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify potential topics from conversation.

## Acceptance Criteria

- [x] `buildHumanTopicScanPrompt(data: TopicScanPromptData)` implemented
- [x] Prompt receives `messages_context` + `messages_analyze` (pre-split)
- [x] Prompt asks LLM to identify topics the human discussed/cares about
- [x] Returns JSON array of `{ name, description, exposure_level }` candidates
- [x] `handleHumanTopicScan` handler implemented
- [x] Handler chains each candidate to Step 2 (0064)

## Notes

**CONTRACTS.md Reference**:
```typescript
interface TopicScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}
```

**V0 Reference**: `v0/src/prompts/extraction/step1/topics.ts`

## Implementation

- `src/prompts/human/topic-scan.ts` - Prompt builder
- `src/prompts/human/types.ts` - Type definitions
- `src/core/handlers/index.ts` - Handler implementation
