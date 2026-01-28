# 0063: Human Person Scan (Step 1) Prompt + Handler

**Status**: DONE
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify people mentioned in conversation.

## Acceptance Criteria

- [x] `buildHumanPersonScanPrompt(data: PersonScanPromptData)` implemented
- [x] Prompt receives `messages_context` + `messages_analyze` (pre-split)
- [x] Prompt receives `known_persona_names` to avoid confusion
- [x] Prompt asks LLM to identify people the human mentioned
- [x] Returns JSON array of `{ name, relationship, description }` candidates
- [x] `handleHumanPersonScan` handler implemented
- [x] Handler chains each candidate to Step 2 (0064)

## Notes

**CONTRACTS.md Reference**:
```typescript
interface PersonScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  known_persona_names: string[];  // To avoid confusing personas with people
}
```

**V0 Reference**: `v0/src/prompts/extraction/step1/people.ts`

## Implementation

- `src/prompts/human/person-scan.ts` - Prompt builder
- `src/prompts/human/types.ts` - Type definitions
- `src/core/handlers/index.ts` - Handler implementation
- `src/core/orchestrators/human-extraction.ts` - Gets persona names from StateManager
