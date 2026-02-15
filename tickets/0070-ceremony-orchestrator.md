# 0070: Ceremony Orchestrator

**Status**: DONE
**Depends on**: 0065

## Summary

Nightly background job that coordinates the Ceremony phases across all entities.

## Acceptance Criteria

- [x] Scheduler triggers Ceremony at configurable time (default: 3am local)
- [x] Orchestrator processes personas in order, Ei last
- [x] For each active persona that had activity:
  - Enqueue Exposure phase (0071)
  - On completion: Enqueue Decay phase (0072)
- [x] After all personas: Run Human Ceremony (0075)
- [x] Uses queue-driven chaining (handlers enqueue next step)
- [x] Skip paused/archived personas
- [x] Configurable via settings (enable/disable, time)

## Notes

**V1 Backward Reference**:
- "Ceremony describes the NIGHTLY background process: Exposure, Decay, Expire, Explore"
- "Ei is always the LAST Persona to run"
- "Check if Human has interacted. If not, Skip"

Architecture: Orchestrator enqueues Step 1, handlers chain subsequent steps.
