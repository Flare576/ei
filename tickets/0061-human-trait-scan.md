# 0061: Human Trait Scan (Step 1) Prompt + Handler

**Status**: DONE
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify potential traits from conversation.

## Acceptance Criteria

- [x] `buildHumanTraitScanPrompt(data: TraitScanPromptData)` implemented
- [x] Prompt receives `messages_context` + `messages_analyze` (pre-split)
- [x] Prompt asks LLM to identify behavioral/personality traits exhibited
- [x] Returns JSON array of `{ name, description, strength }` candidates
- [x] `handleHumanTraitScan` handler implemented
- [x] Handler chains each candidate to Step 2 (0064)

## Notes

**CONTRACTS.md Reference**:
```typescript
interface TraitScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}
```

**V0 Reference**: `v0/src/prompts/extraction/step1/traits.ts`

## Implementation

- `src/prompts/human/trait-scan.ts` - Prompt builder
- `src/prompts/human/types.ts` - Type definitions
- `src/core/handlers/index.ts` - Handler implementation
