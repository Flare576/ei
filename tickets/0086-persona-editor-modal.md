# 0086: Persona Editor Modal

**Status**: DONE
**Depends on**: 0080

## Summary

Editor modal for existing personas with Settings, Identity, Topics, Context tabs.

## Acceptance Criteria

- [x] Uses Entity Editor Modal shell (0080)
- [x] Settings tab:
  - Heartbeat length
  - Default Context Window
  - Paused (with time remaining or infinity)
  - Archived toggle
  - Dynamic vs Static toggle
  - LLM Model selector
  - Group assignment
  - Group Visibility (multi-select)
- [x] Identity tab:
  - Image display (read-only for now)
  - Aliases editor
  - Short description
  - Long description (dual-mode editor)
  - Traits list (card-based)
- [x] Topics tab: Card-based topic list
- [x] Context tab: See ticket 0088

## Notes

**V1 Backward Reference**:
- "Edit opens Modal Entity Editor with Settings, Identity, Topics, Context"
- Dynamic vs Static: "Static skips all Ceremony phases"
