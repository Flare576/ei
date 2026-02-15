# 0072: Decay Phase

**Status**: DONE
**Depends on**: 0070

## Summary

Ceremony phase that applies time-based decay to exposure values.

## Acceptance Criteria

- [x] No LLM call needed - pure computation
- [x] For each persona topic: Apply decay formula to `exposure_current`
- [x] Decay rate configurable (default: ~10% per day)
- [x] Topics not discussed decay toward 0
- [x] Record pre-decay values for delta calculation
- [x] On completion: Enqueue Expire phase (0073)
- [x] Static personas skip this phase

## Notes

**V1 Backward Reference**:
- "Ceremony - Decay: No LLM call - cycle through Persona and apply decay to every Topic"
- "Regardless, for any DP that comes back with changes, update and set last_updated timestamp"

Decay is mathematical, not AI-driven. Simple exponential decay.
