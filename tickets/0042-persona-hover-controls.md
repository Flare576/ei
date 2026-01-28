# 0042: Persona Panel: Hover Controls

**Status**: DONE
**Depends on**: 0041

## Summary

Show action controls when hovering over a persona pill: Pause, Edit, Archive, Delete.

## Acceptance Criteria

- [x] Controls appear on hover, right side of pill
- [x] Pause: Toggle persona pause state (infinity by default)
- [x] Pause hover: Show duration options (1h, 8h, 24h, infinity)
- [x] Edit: Open persona editor modal (ticket 0086) - placeholder alert for now
- [x] Archive: Remove from list, show toast "Archived Personas appear in [icon]"
- [x] Delete: Confirmation dialog with checkbox "Also delete traits this Persona learned"
- [x] Controls keyboard accessible when pill focused

## Notes

**V1 Backward Reference**:
- "On Hover, controls appear at right: Pause, edit, archive, delete"
- Delete: "Warning message flies in, red and angry"
- No double-confirmation — auto-save is available for undo

## Implementation

- `PersonaPanel.tsx` updated with hover state tracking
- Control buttons appear on hover with icon buttons
- Pause dropdown with duration options (1h, 8h, 24h, forever)
- Archive shows toast notification
- Delete shows modal confirmation with checkbox for data deletion
- CSS for controls, pause options dropdown, delete modal, toast
- Handlers in App.tsx call Processor methods
- Edit shows placeholder alert (actual modal is ticket 0086)
