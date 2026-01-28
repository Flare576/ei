# 0061: Human Trait Scan (Step 1) Prompt + Handler

**Status**: PENDING
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify potential traits from conversation.

## Acceptance Criteria

- [ ] `buildHumanTraitScanPrompt(data: TraitScanPromptData)` implemented
- [ ] Prompt receives `messages_context` + `messages_analyze` (pre-split)
- [ ] Prompt asks LLM to identify behavioral/personality traits exhibited
- [ ] Returns JSON array of `{ name, description, strength }` candidates
- [ ] `handleHumanTraitScan` handler implemented
- [ ] Handler chains each candidate to Step 2 (0064)

## Notes

**CONTRACTS.md Reference**:
```typescript
interface TraitScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}
```

**V0 Reference**: `v0/src/prompts/human/traitScan.ts`
