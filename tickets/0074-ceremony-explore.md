# 0074: Explore Phase

**Status**: PENDING
**Depends on**: 0073

## Summary

Ceremony phase that generates new topics for personas running low.

## Acceptance Criteria

- [ ] Triggered only if persona topic count below threshold after Expire
- [ ] `buildPersonaExplorePrompt(data)` implemented
- [ ] Prompt receives persona traits, remaining topics, recent conversation themes
- [ ] LLM suggests new topics aligned with persona's personality
- [ ] Returns array of new Topic objects
- [ ] `handlePersonaExplore` handler adds topics to persona
- [ ] New topics start with moderate exposure_desired, low exposure_current
- [ ] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Explore: Execute only if Persona is 'low' on topics after Expire"
- "An earlier agent DID make this prompt, but we haven't tested it yet"

**V0 Reference**: `v0/src/prompts/persona/explore.ts` (untested)
