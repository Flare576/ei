# 0015: Persona Switching (Commands + Navigation)

**Status**: PENDING

## Summary

Multiple ways to switch personas: slash commands, keyboard navigation, and visual selection.

## Problem

Current `/persona <name>` command works but requires typing. TUI should support faster switching via keyboard navigation.

## Proposed Solution

### Switching Methods

1. **Command**: `/persona mike` or `/p mike` (existing)
2. **Keyboard nav**: Ctrl+H to focus list, j/k to navigate, Enter to select
3. **Direct shortcut**: Ctrl+1/2/3/4 for first four personas (optional)

### Visual Feedback

```
┌─Personas─┐
│ > ei     │  ← selected (highlighted)
│   mike*  │  ← has unread (bold + asterisk)
│   lena   │
│   beta   │
└──────────┘
```

### Focus States

- **Input focused**: Normal input behavior, Ctrl+H switches to list
- **List focused**: j/k navigate, Enter selects, Esc returns to input
- Visual indicator shows which pane has focus (border color?)

### Switch Behavior

When switching personas:
- Save current input (don't lose draft)
- Load new persona's chat history
- Clear unread indicator for new persona
- Don't interrupt background processing on old persona

### State Management

```typescript
const [activePersona, setActivePersona] = useState("ei");
const [focusedPane, setFocusedPane] = useState<"input" | "list">("input");
const [draftInputs, setDraftInputs] = useState<Map<string, string>>(new Map());
```

## Acceptance Criteria

- [ ] `/persona` command still works
- [ ] Ctrl+H focuses persona list
- [ ] j/k navigate list when focused
- [ ] Enter switches to highlighted persona
- [ ] Esc returns focus to input
- [ ] Draft input preserved when switching
- [ ] Unread indicator clears on switch
- [ ] Background processing continues for old persona

## Value Statement

Fast persona switching without interrupting flow. Keyboard-driven for power users.

## Dependencies

- Ticket 0010 (basic ink layout)
- Ticket 0012 (keybindings)
- Ticket 0009 (per-persona queues for background processing)

## Effort Estimate

Medium: ~3-4 hours
