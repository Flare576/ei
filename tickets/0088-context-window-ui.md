# 0088: Context Window UI

**Status**: DONE
**Depends on**: 0086

## Summary

Complex interface for managing message context inclusion for a persona.

## Acceptance Criteria

- [x] Top controls: Start datetime picker, End datetime picker
- [x] Messages list: paginated, 50 at a time
- [x] Columns: Who, When, What (truncated), Context status
- [x] Background color indicates context window:
  - Green: within sliding window (or Always)
  - Gray: outside window (or Never)
- [x] Click message "What" to view full content (sub-modal or expansion)
- [x] Context status dropdown: Default, Always, Never
- [x] Bulk action: "Set all matching time filter to {status}"
- [x] Sliding window size shown (from persona settings)

## Notes

**V1 Backward Reference**:
- "By far the most complicated interface in my mind"
- "Sliding Context Window represented by background color"
- "Calendar + clock for Start and End at top"
- "Paginated, 50 at a time"
- "Editor lets you mark individual, or 'All messages matching time filters'"

This is the power-user interface for fine-tuning what a persona "remembers".
