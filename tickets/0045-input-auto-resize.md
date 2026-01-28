# 0045: Input Box: Auto-resize

**Status**: PENDING
**Depends on**: 0013

## Summary

Input box grows with content up to 33% of window height, then scrolls.

## Acceptance Criteria

- [ ] Starts as single-line height
- [ ] Grows as user types multi-line content
- [ ] Maximum height: 33% of viewport
- [ ] Scrollbar appears when max height reached
- [ ] Shrinks back when content removed
- [ ] Enter sends message (default)
- [ ] Shift+Enter inserts newline (default)
- [ ] Ctrl+C clears input
- [ ] Input persists when switching personas

## Notes

**V1 Backward Reference**:
- "start thin, expand up to 33% of window height"
- "Enter sends, Shift+Enter line break"
- "Switching personas should NOT clear out your input"
- "Ctrl+C _should_ clear out your input"
