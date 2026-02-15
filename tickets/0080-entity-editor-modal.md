# 0080: Entity Editor Modal Shell

**Status**: DONE
**Depends on**: 0040

## Summary

Reusable tabbed modal shell for editing Human and Persona entities.

## Acceptance Criteria

- [x] Modal component with tab navigation
- [x] Tabs render dynamically based on entity type
- [x] Human tabs: Settings, Facts, Traits, Topics, People
- [x] Persona tabs: Settings, Identity, Topics, Context
- [x] Tab content area with consistent padding/scrolling
- [x] Close button (X) and Escape key close modal
- [x] Focus trap while open
- [x] Dirty state warning on close attempt

## Notes

**V1 Backward Reference**:
- "Settings button opens 'Edit Modal' for Human entity"
- "Tabbed-navigated editor"

This is the shell; individual tabs are separate tickets.
