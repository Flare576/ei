# 0088: Context Window UI

**Status**: PENDING
**Depends on**: 0086

## Summary

Complex interface for managing message context inclusion for a persona.

## Acceptance Criteria

- [ ] Top controls: Start datetime picker, End datetime picker
- [ ] Messages list: paginated, 50 at a time
- [ ] Columns: Who, When, What (truncated), Context status
- [ ] Background color indicates context window:
  - Green: within sliding window (or Always)
  - Gray: outside window (or Never)
- [ ] Click message "What" to view full content (sub-modal or expansion)
- [ ] Context status dropdown: Default, Always, Never
- [ ] Bulk action: "Set all matching time filter to {status}"
- [ ] Sliding window size shown (from persona settings)

## Notes

**V1 Backward Reference**:
- "By far the most complicated interface in my mind"
- "Sliding Context Window represented by background color"
- "Calendar + clock for Start and End at top"
- "Paginated, 50 at a time"
- "Editor lets you mark individual, or 'All messages matching time filters'"

This is the power-user interface for fine-tuning what a persona "remembers".
