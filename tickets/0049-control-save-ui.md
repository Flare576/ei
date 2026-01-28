# 0049: Control Area: Save UI

**Status**: PENDING
**Depends on**: 0040

## Summary

Save slot interface following video game save/load pattern.

## Acceptance Criteria

- [ ] Display manual save slots (10-14) with name + timestamp
- [ ] Display auto-save slots (0-9) in collapsible section
- [ ] Save to slot: Select slot, enter name, confirm
- [ ] Load from slot: Select slot, confirm (warn about overwrite)
- [ ] Delete manual save: Confirm dialog
- [ ] "Undo" button: Step back through auto-saves one at a time
- [ ] Undo is last element in UI (emphasize no "Redo")
- [ ] UI disabled during checkpoint operations (onCheckpointStart → onCheckpointCreated)

## Notes

**V1 Backward Reference**:
- "video game save slot model"
- "Undo button to step back through auto-saves one at a time"
- "Undo button should be last thing in UI, to make it super clear there's no Redo"

**CONTRACTS.md Reference**:
- Slots 0-9: auto-save, FIFO
- Slots 10-14: manual save
