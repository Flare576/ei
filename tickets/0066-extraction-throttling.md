# 0066: Extraction Frequency Throttling (Ei-only)

**Status**: DONE
**Depends on**: 0065

## Summary

Implement scaling extraction frequency: extract more often when data is sparse.

## Acceptance Criteria

- [x] `lastSeeded_fact`, `lastSeeded_trait`, `lastSeeded_person`, `lastSeeded_topic` fields on HumanEntity
- [x] On message to Ei: Count messages since lastSeeded timestamp
- [x] If `entity.{type}.length < messagesSinceTimestamp`: trigger extraction
- [x] Update lastSeeded timestamp after extraction
- [x] Only Ei triggers this frequent extraction; others wait for Ceremony
- [x] Processor orchestrates this check in handlePersonaResponse (for Ei)

## Notes

**V1 Backward Reference**:
- "only one Persona really needs to run 'Extractions' with frequency - Ei"
- "If they had 0 traits, extraction ran every message. 10+ traits, every 10 messages"
- "Ei is the persona that gets the most facts/traits early, helping other Personas know the user"

## Implementation

- `src/core/types.ts` - Added lastSeeded_* fields to HumanEntity
- `src/core/processor.ts` - Added `checkAndQueueHumanExtraction()` method
- Extraction only triggered when talking to Ei (personaName === "ei")
- Logic: if human has fewer items of a type than messages since last seed, trigger extraction
