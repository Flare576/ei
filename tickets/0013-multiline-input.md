# 0013: Multi-line Input with Visual Feedback

**Status**: VALIDATED

## Summary

Implement multi-line text input in the TUI with proper visual rendering and cursor management.

## Problem

Readline is single-line only. Users need to compose multi-line messages (code blocks, formatted text, lists) directly in the input area.

## Proposed Solution

### Visual Behavior

```
┌─Input────────────────────────────────┐
│ > Hey, here's some code:            │
│   ```js                              │
│   function foo() {                   │
│     return "bar";                    │
│   }                                  │
│   ```                                │
│   What do you think?_                │
└──────────────────────────────────────┘
```

### Input Mechanics

- Ctrl+J inserts newline
- Enter submits entire multi-line content
- Up/Down arrows navigate within text (not history)
- Input area grows vertically as needed (up to max)
- Visual indicator shows line count when > 1 line

### Component Design

```tsx
const MultiLineInput = ({ onSubmit, maxLines = 10 }) => {
  const [lines, setLines] = useState([""]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  
  // Handle key events, cursor movement, text insertion
  // Render with proper line wrapping and cursor position
};
```

### Edge Cases

- Very long lines: **wrap visually**, arrow keys follow visual path (not buffer position)
- Max height: scroll within input area
- Empty submission: ignore silently (consistent with readline behavior)
- Pasting multi-line content: handle newlines

## Acceptance Criteria

- [x] Ctrl+J adds new line
- [x] Multiple lines render correctly
- [x] Cursor navigates within multi-line content
- [x] Enter submits all lines as single message
- [x] Input area expands/contracts with content
- [x] Works with `/commands` on first line

## Value Statement

Compose complex messages naturally without external editor (though /editor remains for heavy lifting).

## Dependencies

- Ticket 0010 (basic ink layout)
- Ticket 0012 (keybindings)

## Effort Estimate

Medium: ~3-4 hours
