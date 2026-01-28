# 0072: Decay Phase

**Status**: PENDING
**Depends on**: 0070

## Summary

Ceremony phase that applies time-based decay to exposure values.

## Acceptance Criteria

- [ ] No LLM call needed - pure computation
- [ ] For each persona topic: Apply decay formula to `exposure_current`
- [ ] Decay rate configurable (default: ~10% per day)
- [ ] Topics not discussed decay toward 0
- [ ] Record pre-decay values for delta calculation
- [ ] On completion: Enqueue Expire phase (0073)
- [ ] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Decay: No LLM call - cycle through Persona and apply decay to every Topic"
- "Regardless, for any DP that comes back with changes, update and set last_updated timestamp"

Decay is mathematical, not AI-driven. Simple exponential decay.
