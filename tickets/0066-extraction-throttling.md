# 0066: Extraction Frequency Throttling (Ei-only)

**Status**: PENDING
**Depends on**: 0065

## Summary

Implement scaling extraction frequency: extract more often when data is sparse.

## Acceptance Criteria

- [ ] `lastSeeded_fact`, `lastSeeded_trait`, `lastSeeded_person`, `lastSeeded_topic` fields on HumanEntity
- [ ] On message to Ei: Count messages since lastSeeded timestamp
- [ ] If `entity.{type}.length < messagesSinceTimestamp`: trigger extraction
- [ ] Update lastSeeded timestamp after extraction
- [ ] Only Ei triggers this frequent extraction; others wait for Ceremony
- [ ] Processor orchestrates this check in handlePersonaResponse (for Ei)

## Notes

**V1 Backward Reference**:
- "only one Persona really needs to run 'Extractions' with frequency - Ei"
- "If they had 0 traits, extraction ran every message. 10+ traits, every 10 messages"
- "Ei is the persona that gets the most facts/traits early, helping other Personas know the user"
