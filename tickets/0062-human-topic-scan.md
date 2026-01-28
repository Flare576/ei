# 0062: Human Topic Scan (Step 1) Prompt + Handler

**Status**: PENDING
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify potential topics from conversation.

## Acceptance Criteria

- [ ] `buildHumanTopicScanPrompt(data: TopicScanPromptData)` implemented
- [ ] Prompt receives `messages_context` + `messages_analyze` (pre-split)
- [ ] Prompt asks LLM to identify topics the human discussed/cares about
- [ ] Returns JSON array of `{ name, description, exposure_level }` candidates
- [ ] `handleHumanTopicScan` handler implemented
- [ ] Handler chains each candidate to Step 2 (0064)

## Notes

**CONTRACTS.md Reference**:
```typescript
interface TopicScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}
```

**V0 Reference**: `v0/src/prompts/human/topicScan.ts`
