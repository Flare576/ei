# 0071: Exposure Phase

**Status**: DONE
**Depends on**: 0070

## Summary

Ceremony phase that updates exposure values based on recent conversation activity.

## Acceptance Criteria

- [x] For each persona: Analyze messages since last ceremony
- [x] Enqueue Human scans (0060-0063) for each data type
- [x] Enqueue Persona topic scan (0025)
- [x] Step 3 handlers update `exposure_current` based on conversation frequency
- [x] High/medium/low/none mapped to exposure values via log function
- [x] On completion: Enqueue Decay phase
- [x] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Exposure: For each Persona, Enqueue Step 1 for human [Fact|trait|person|topic], and Step 1 for Persona [Topic]"

This is the "data gathering" phase that identifies what was discussed.
