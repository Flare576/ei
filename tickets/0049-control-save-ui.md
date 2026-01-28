# 0049: Control Area: Save UI

**Status**: DONE
**Depends on**: 0040

## Summary

Save slot interface following video game save/load pattern.

## Acceptance Criteria

- [x] Display manual save slots (10-14) with name + timestamp
- [x] Display auto-save slots (0-9) in collapsible section
- [x] Save to slot: Select slot, enter name, confirm
- [x] Load from slot: Select slot, confirm (warn about overwrite)
- [x] Delete manual save: Confirm dialog
- [x] "Undo" button: Step back through auto-saves one at a time
- [x] Undo is last element in UI (emphasize no "Redo")
- [x] UI disabled during checkpoint operations (onCheckpointStart → onCheckpointCreated)

## Notes

**V1 Backward Reference**:
- "video game save slot model"
- "Undo button to step back through auto-saves one at a time"
- "Undo button should be last thing in UI, to make it super clear there's no Redo"

**CONTRACTS.md Reference**:
- Slots 0-9: auto-save, FIFO
- Slots 10-14: manual save

## Implementation

- `SavePanel.tsx` - Complete save/load UI component
- Manual slots (10-14) displayed with save/load/delete options
- Auto-saves (0-9) in collapsible section, load-only
- Save dialog with name input and overwrite warning
- Load dialog with confirmation
- Delete dialog with confirmation
- Undo button at bottom with "No redo available" note
- Panel disabled during checkpoint operations via `isOperationInProgress` prop
- Popover positioning from save button in ControlArea
