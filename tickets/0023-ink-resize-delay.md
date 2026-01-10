# 0023: INK - Reduce Layout Resize Delay

**Status**: PENDING

## Problem

When resizing the terminal window, there's a noticeable delay (several seconds) before the layout updates to the appropriate mode (full/medium/compact). Users expect near-instant responsiveness.

## Acceptance Criteria

- [ ] Layout changes within 200ms of terminal resize
- [ ] No visual glitches during transition
- [ ] Smooth experience when rapidly resizing

## Technical Notes

- Currently using `useStdout()` hook from Ink to get dimensions
- May need to investigate Ink's resize event handling
- Consider debouncing vs throttling tradeoffs

## Priority

Low - Core functionality works, this is polish.
