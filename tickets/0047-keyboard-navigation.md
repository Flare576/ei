# 0047: Keyboard Navigation

**Status**: DONE
**Depends on**: 0040

## Summary

Full keyboard navigation for power users.

## Acceptance Criteria

- [x] Ctrl+H: Move focus from input to persona panel
- [x] Ctrl+L: Move focus from persona panel to input
- [x] Up/Down in persona panel: Navigate personas
- [x] Enter/Space in persona panel: Select persona, return to input
- [x] Left/Right on persona pill: Navigate hover controls
- [x] Enter/Space on control: Activate it
- [x] Page Up/Down: Always scroll chat history
- [x] Escape: Toggle system pause
- [x] Focus indicators clearly visible

## Notes

**V1 Backward Reference**:
- "Ctrl+h moves focus to Persona panel"
- "Up/Down moves through personas, Enter/Space selects and returns to input"
- "Ctrl+l moves back to input"
- "Page Up/Down always scrolls chat history"
- "Escape anywhere Pauses/Unpauses"

## Implementation

- `hooks/useKeyboardNavigation.ts` - Global keyboard handler hook
- Components use forwardRef + useImperativeHandle to expose focus methods
- PersonaPanel tracks focusedIndex for arrow key navigation
- ChatPanel exposes scrollChat for Page Up/Down
- Focus indicators via CSS `:focus` with accent-colored outline
- Escape handler already in ControlArea (from 0048)
