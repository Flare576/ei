# 0063: Human Person Scan (Step 1) Prompt + Handler

**Status**: PENDING
**Depends on**: 0011

## Summary

Step 1 of human data extraction: Identify people mentioned in conversation.

## Acceptance Criteria

- [ ] `buildHumanPersonScanPrompt(data: PersonScanPromptData)` implemented
- [ ] Prompt receives `messages_context` + `messages_analyze` (pre-split)
- [ ] Prompt receives `known_persona_names` to avoid confusion
- [ ] Prompt asks LLM to identify people the human mentioned
- [ ] Returns JSON array of `{ name, relationship, description }` candidates
- [ ] `handleHumanPersonScan` handler implemented
- [ ] Handler chains each candidate to Step 2 (0064)

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

**V0 Reference**: `v0/src/prompts/human/personScan.ts`
