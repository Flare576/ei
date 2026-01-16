# 0077: Help Modal Popup

**Status**: PENDING

## Summary
Replace the single-line status bar `/help` output with a proper modal popup dialog that can display multi-line help text and be dismissed with any keypress.

## Problem
The current `/help` command outputs to the status bar, which is a single line at the bottom of the screen. As we add more commands, the help text won't fit. We need a modal popup that:
- Displays multi-line formatted help text
- Is read-only (user can't edit)
- Can be dismissed with any keypress
- Overlays the existing UI temporarily
- Returns focus to the input box when dismissed

## Proposed Solution

Use `blessed.message()` — it's purpose-built for this exact use case.

### Implementation

```typescript
// Create once during app init (in layout-manager.ts)
const helpModal = blessed.message({
  parent: screen,
  top: 'center',
  left: 'center',
  height: 'shrink',
  width: '85%',
  align: 'left',
  tags: true,
  hidden: true,
  border: { type: 'line' },
  label: ' Help ',
  scrollable: true,  // For long content
  keys: true,
  vi: true,          // j/k scrolling
  style: { border: { fg: 'cyan' } }
});

// To show it (any keypress dismisses, focus auto-restores)
helpModal.display(helpText, -1, () => {
  // Optional callback after dismiss
});
```

### Key Behaviors

| Feature | How It Works |
|---------|--------------|
| Modal blocking | `display()` captures all input until dismissed |
| Dismissal | ANY keypress (except scroll keys if `scrollable: true`) |
| Focus restoration | Automatic — saves/restores via `screen.saveFocus()` |
| Scrolling | Enable `scrollable: true` + `vi: true` for j/k navigation |

### Integration Points

1. **layout-manager.ts**: Create and expose the `helpModal` widget
2. **app.ts**: Update `/help` command handler to call `helpModal.display()` instead of `setStatus()`
3. **Help text**: Format with blessed tags for styling (`{bold}`, `{cyan-fg}`, etc.)

### Example Help Content

```typescript
const helpText = `
{bold}Commands{/bold}

  /persona [name]     Switch persona (or list if no name)
  /pause [duration]   Pause active persona (30m, 2h, or indefinite)
  /resume [persona]   Resume paused persona
  /editor, /e         Open external editor for multi-line input
  /refresh, /r        Refresh UI layout
  /quit [--force]     Exit application
  /help               Show this help

{bold}Keyboard Shortcuts{/bold}

  Ctrl+E              Open external editor
  Ctrl+C              Clear input / abort operation / exit
  Ctrl+H              Focus persona list
  Ctrl+L              Focus input
  Ctrl+R              Refresh UI
  PageUp/PageDown     Scroll chat history
  Escape, Q           Quit application

{bold}Tips{/bold}

  - Press any key to dismiss this help
  - Use j/k to scroll if help text is long
`;
```

## Acceptance Criteria
- [ ] `/help` displays a centered modal popup instead of status bar text
- [ ] Modal contains formatted, multi-line help text
- [ ] Any keypress dismisses the modal (except scroll keys)
- [ ] Focus returns to input box after dismissal
- [ ] Modal supports scrolling for long content (j/k or arrow keys)
- [ ] Help text includes all current commands and shortcuts
- [ ] Modal has visible border and "Help" label

## Gotchas & Best Practices

From blessed source analysis:

- **Reuse the widget** — create once at init with `hidden: true`, don't recreate on every `/help`
- **Use `time: -1`** — waits for keypress (positive numbers auto-dismiss after N seconds)
- **Don't manually show/hide** — `display()` handles show/hide/focus automatically
- **`scrollable: true` changes dismissal** — scroll keys (j/k/arrows) scroll instead of dismiss

## Value Statement
Proper help display enables discoverability of features. As the command set grows, users need a readable way to see all available options.

## Dependencies
None

## Effort Estimate
Small (~30 minutes)
- Add helpModal to layout-manager.ts: 10 min
- Update /help handler in app.ts: 5 min
- Format help text content: 15 min
