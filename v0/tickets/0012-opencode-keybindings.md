# 0012: OpenCode-Compatible Keybindings

**Status**: IN_PROGRESS

## Summary

Implement keyboard shortcuts matching OpenCode conventions so muscle memory transfers.

## Problem

Users familiar with OpenCode (or vim-style navigation) expect consistent keybindings. Custom shortcuts create friction.

## Proposed Solution

### Input Area Keys

| Key | Action |
|-----|--------|
| Enter | Submit message |
| Ctrl+J | Insert newline (multi-line input) |
| Up/Down | Navigate within multi-line input |
| Ctrl+C | Cancel current input / exit |
| Ctrl+U | Clear input line |

### Pane Navigation

| Key | Action |
|-----|--------|
| Ctrl+H | Focus persona list (left) |
| Ctrl+L | Focus chat/input (right) |

### Persona List Keys (when focused)

| Key | Action |
|-----|--------|
| j / Down | Next persona |
| k / Up | Previous persona |
| Enter | Switch to highlighted persona |
| Esc | Return focus to input |

### Chat History Keys (future)

| Key | Action |
|-----|--------|
| Ctrl+B | Scroll up (page) |
| Ctrl+F | Scroll down (page) |
| g | Jump to top |
| G | Jump to bottom |

### Implementation

```tsx
const { useInput } = require("ink");

useInput((input, key) => {
  if (key.ctrl && input === "j") {
    insertNewline();
  } else if (key.ctrl && input === "h") {
    focusPersonaList();
  }
  // ...
});
```

## Acceptance Criteria

- [x] Ctrl+J inserts newline in input
- [x] Arrow keys work for text navigation
- [ ] Ctrl+H/L switch pane focus
- [ ] j/k navigate persona list when focused
- [ ] Enter submits from input, selects from list
- [ ] Esc returns to input from any pane

## Value Statement

No new muscle memory required. If you know OpenCode/vim, you know EI.

## Dependencies

- Ticket 0010 (basic ink layout)

## Effort Estimate

Small-Medium: ~2-3 hours

---

## Comments

### 2026-01-09 - First QA Pass (FAILED)

Human validation failed all pane-related acceptance criteria:
- No visual indicator when pane focus changes
- j/k keys still type in input after Ctrl+H (focus not actually switching)
- Possible edge case: only one persona exists, may affect list behavior

Note: Ctrl+J (multiline input) works correctly - validated in ticket 0013.
