# 0045: Input Box: Auto-resize

**Status**: DONE
**Depends on**: 0013

## Summary

Input box grows with content up to 33% of window height, then scrolls.

## Acceptance Criteria

- [x] Starts as single-line height
- [x] Grows as user types multi-line content
- [x] Maximum height: 33% of viewport
- [x] Scrollbar appears when max height reached
- [x] Shrinks back when content removed
- [x] Enter sends message (default)
- [x] Shift+Enter inserts newline (default)
- [x] Ctrl+C clears input
- [x] Input persists when switching personas

## Notes

**V1 Backward Reference**:
- "start thin, expand up to 33% of window height"
- "Enter sends, Shift+Enter line break"
- "Switching personas should NOT clear out your input"
- "Ctrl+C _should_ clear out your input"

## Implementation

- `ChatPanel.tsx` uses `adjustTextareaHeight()` callback
- Height calculated: `min(scrollHeight, window.innerHeight * 0.33)`
- Runs on every input change via useEffect
- Ctrl+C handler clears input value
- Input state managed in App.tsx, persists across persona switches
- CSS: `overflow-y: auto` for scrollbar when max height reached
