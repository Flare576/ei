# 0082: Human Facts Tab

**Status**: DONE
**Depends on**: 0080

## Summary

Facts tab in Human entity editor showing all learned facts.

## Acceptance Criteria

- [x] Card-based list of facts
- [x] Each card shows: Name (full-width single line), Description (multi-line)
- [x] Split pane row: "Learned By: {persona}" left, Sentiment slider + Confidence slider center, Save/Restore right
- [x] Save/Restore light up when card is dirty
- [x] Grouped by `persona_groups` with collapsible headings
- [x] "General" group at top
- [x] Add new fact button
- [x] Delete fact (with confirmation)

## Notes

**V1 Backward Reference**:
- "Each 'thing' will have an easy-to-use Card"
- "Broken down by Group Headings"
- "Save/Restore buttons light up when dirty"
