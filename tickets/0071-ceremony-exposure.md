# 0071: Exposure Phase

**Status**: PENDING
**Depends on**: 0070

## Summary

Ceremony phase that updates exposure values based on recent conversation activity.

## Acceptance Criteria

- [ ] For each persona: Analyze messages since last ceremony
- [ ] Enqueue Human scans (0060-0063) for each data type
- [ ] Enqueue Persona topic scan (0025)
- [ ] Step 3 handlers update `exposure_current` based on conversation frequency
- [ ] High/medium/low/none mapped to exposure values via log function
- [ ] On completion: Enqueue Decay phase
- [ ] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Exposure: For each Persona, Enqueue Step 1 for human [Fact|trait|person|topic], and Step 1 for Persona [Topic]"

This is the "data gathering" phase that identifies what was discussed.
