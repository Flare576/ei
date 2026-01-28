# 0042: Persona Panel: Hover Controls

**Status**: PENDING
**Depends on**: 0041

## Summary

Show action controls when hovering over a persona pill: Pause, Edit, Archive, Delete.

## Acceptance Criteria

- [ ] Controls appear on hover, right side of pill
- [ ] Pause: Toggle persona pause state (infinity by default)
- [ ] Pause hover: Show duration options (1h, 8h, 24h, infinity)
- [ ] Edit: Open persona editor modal (ticket 0086)
- [ ] Archive: Remove from list, show toast "Archived Personas appear in [icon]"
- [ ] Delete: Confirmation dialog with checkbox "Also delete traits this Persona learned"
- [ ] Controls keyboard accessible when pill focused

## Notes

**V1 Backward Reference**:
- "On Hover, controls appear at right: Pause, edit, archive, delete"
- Delete: "Warning message flies in, red and angry"
- No double-confirmation — auto-save is available for undo
