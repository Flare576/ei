# 0076: Description Regeneration

**Status**: PENDING
**Depends on**: 0074

## Summary

After Ceremony phases, cautiously update persona descriptions if warranted.

## Acceptance Criteria

- [ ] `buildDescriptionCheckPrompt(data)` implemented
- [ ] Prompt receives current descriptions + updated traits/topics
- [ ] LLM evaluates if "drastic departure" warrants update
- [ ] Returns: `{ should_update: boolean, reason?: string }`
- [ ] If update warranted: Call `buildPersonaDescriptionsPrompt` (0023)
- [ ] Update long_description, then regenerate short_description
- [ ] Very conservative threshold - user's initial description is precious
- [ ] Static personas skip this entirely

## Notes

**V1 Backward Reference**:
- "After Persona Update cycle, send VERY cautious call to see if we should update long description"
- "We're putting focus on Persona Builder with human in the loop"
- "Should update only if LLM sees drastic departure from Topics/Traits"

Err heavily on the side of NOT updating. User invested time in their description.
