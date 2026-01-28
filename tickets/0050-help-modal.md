# 0050: Help Modal

**Status**: DONE
**Depends on**: 0040
**Completed**: 2026-01-28

## Summary

Help modal accessible via "?" button with keyboard shortcuts and basic usage guide.

## Acceptance Criteria

- [x] "?" button in control area opens modal
- [x] Keyboard shortcuts reference
- [x] Brief explanation of core concepts (personas, checkpoints, etc.)
- [x] Link to full documentation (external)
- [x] Escape or click outside closes modal
- [x] Accessible (proper ARIA labels, focus trap)

## Notes

**V1 Backward Reference**:
- "Opens a modal with help information"
- "I haven't decided what needs to go in here yet because I'm trying to make everything smooth"

Start minimal. Add content as UX issues surface.

## Implementation

- `web/src/components/Layout/HelpModal.tsx` - Modal with keyboard shortcuts, core concepts, tips
- CSS in `web/src/styles/layout.css` - `.ei-help-modal` and related classes
- Wired up in `App.tsx` with `showHelp` state and `handleHelpClick` handler
