# 0060: Human Fact Scan (Step 1) Prompt + Handler

**Status**: DONE
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify potential facts from conversation.

## Acceptance Criteria

- [x] `buildHumanFactScanPrompt(data: FactScanPromptData)` implemented
- [x] Prompt receives `messages_context` + `messages_analyze` (pre-split by Processor)
- [x] Prompt asks LLM to identify factual statements about the human
- [x] Returns JSON array of `{ name, value, confidence }` candidates
- [x] `handleHumanFactScan` handler implemented
- [x] Handler chains each candidate to Step 2 (0064)
- [x] Handler passes `persona_name` to Step 2 for `learned_by`

## Notes

**CONTRACTS.md Reference**:
```typescript
interface FactScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}
```

**V0 Reference**: `v0/src/prompts/extraction/step1/facts.ts`

## Implementation

- `src/prompts/human/fact-scan.ts` - Prompt builder
- `src/prompts/human/types.ts` - Type definitions
- `src/core/handlers/index.ts` - Handler implementation
- `src/core/orchestrators/human-extraction.ts` - Orchestration to Step 2
