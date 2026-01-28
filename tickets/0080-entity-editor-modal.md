# 0080: Entity Editor Modal Shell

**Status**: PENDING
**Depends on**: 0040

## Summary

Reusable tabbed modal shell for editing Human and Persona entities.

## Acceptance Criteria

- [ ] Modal component with tab navigation
- [ ] Tabs render dynamically based on entity type
- [ ] Human tabs: Settings, Facts, Traits, Topics, People
- [ ] Persona tabs: Settings, Identity, Topics, Context
- [ ] Tab content area with consistent padding/scrolling
- [ ] Close button (X) and Escape key close modal
- [ ] Focus trap while open
- [ ] Dirty state warning on close attempt

## Notes

**V1 Backward Reference**:
- "Settings button opens 'Edit Modal' for Human entity"
- "Tabbed-navigated editor"

This is the shell; individual tabs are separate tickets.
