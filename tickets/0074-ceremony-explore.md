# 0074: Explore Phase

**Status**: DONE
**Depends on**: 0073

## Summary

Ceremony phase that generates new topics for personas running low.

## Acceptance Criteria

- [x] Triggered only if persona topic count below threshold after Expire
- [x] `buildPersonaExplorePrompt(data)` implemented
- [x] Prompt receives persona traits, remaining topics, recent conversation themes
- [x] LLM suggests new topics aligned with persona's personality
- [x] Returns array of new Topic objects
- [x] `handlePersonaExplore` handler adds topics to persona
- [x] New topics start with moderate exposure_desired, low exposure_current
- [x] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Explore: Execute only if Persona is 'low' on topics after Expire"
- "An earlier agent DID make this prompt, but we haven't tested it yet"

**V0 Reference**: `v0/src/prompts/persona/explore.ts` (untested)
