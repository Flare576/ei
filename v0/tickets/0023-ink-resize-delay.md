# 0023: INK - Reduce Layout Resize Delay

**Status**: CANCELLED

> Cancelled: This ticket was specific to Ink's resize handling issues. The Blessed migration has resolved these problems - Blessed handles resize events natively without delay through its built-in event system.

## Problem

When resizing the terminal window, there's a noticeable delay (several seconds) before the layout updates to the appropriate mode (full/medium/compact). Users expect near-instant responsiveness.

## Resolution

**OBSOLETE**: Blessed implementation provides instant resize response through native terminal event handling. The resize delay was an Ink-specific limitation that no longer exists.

## Acceptance Criteria

- [x] Layout changes within 200ms of terminal resize ✅ **RESOLVED by Blessed migration**
- [x] No visual glitches during transition ✅ **RESOLVED by Blessed migration**
- [x] Smooth experience when rapidly resizing ✅ **RESOLVED by Blessed migration**

## Technical Notes

- Originally using `useStdout()` hook from Ink to get dimensions
- Blessed uses native SIGWINCH signal handling for instant resize detection
- No debouncing needed - Blessed's native approach is efficient

## Priority

~~Low - Core functionality works, this is polish.~~
**RESOLVED** - No longer applicable after Blessed migration.
