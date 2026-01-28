# 0060: Human Fact Scan (Step 1) Prompt + Handler

**Status**: PENDING
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify potential facts from conversation.

## Acceptance Criteria

- [ ] `buildHumanFactScanPrompt(data: FactScanPromptData)` implemented
- [ ] Prompt receives `messages_context` + `messages_analyze` (pre-split by Processor)
- [ ] Prompt asks LLM to identify factual statements about the human
- [ ] Returns JSON array of `{ name, value, confidence }` candidates
- [ ] `handleHumanFactScan` handler implemented
- [ ] Handler chains each candidate to Step 2 (0064)
- [ ] Handler passes `persona_name` to Step 2 for `learned_by`

## Notes

**CONTRACTS.md Reference**:
```typescript
interface FactScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}
```

**V0 Reference**: `v0/src/prompts/human/factScan.ts`
