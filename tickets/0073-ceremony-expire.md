# 0073: Expire Phase

**Status**: DONE
**Depends on**: 0072

## Summary

Ceremony phase that removes topics the persona no longer cares about.

## Acceptance Criteria

- [x] `buildPersonaExpirePrompt(data)` implemented
- [x] Prompt receives persona's topics with current exposure values
- [x] LLM identifies topics that have decayed below relevance threshold
- [x] Returns list of topic IDs to remove
- [x] `handlePersonaExpire` handler removes identified topics
- [x] Track removed count for Explore phase trigger
- [x] On completion: Enqueue Explore if needed (0074)
- [x] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Expire: Find topics the Persona no longer cares about and remove them"
- "We only execute Explore if the Persona is 'low' on topics after Expire"

Threshold TBD - likely exposure_current < 0.1 for extended period.
