# 0004: Inline Carriage Return Support (Ctrl+J)

**Status**: CANCELLED

> Cancelled: This ticket drove the decision to switch to Ink. See 0013 for Ink-native multi-line input.

## Summary

Add key binding (Ctrl+J or similar) to insert a newline within the current message without submitting it.

## Problem

Even with `/editor` available, users may want quick multi-line input without leaving the chat interface. The current readline implementation submits on Enter with no way to add line breaks inline.

## Proposed Solution

Replace or augment the standard readline interface with enhanced key handling that intercepts Ctrl+J (or another key combo) to insert a newline character instead of submitting.

### Implementation Options

1. **Raw terminal mode**: Use `process.stdin.setRawMode(true)` and handle keypresses manually
2. **Keypress library**: Use `keypress` npm package to detect key combinations
3. **Blessed/blessed-contrib**: Full terminal UI framework with built-in key handling
4. **Inquirer editor mode**: Use `inquirer` package's editor-style input

**Recommendation**: Start with Option 2 (`keypress` library) - lightest touch, good cross-platform support.

### Technical Considerations

- Must preserve existing readline features (history, Ctrl+C, arrow keys)
- Need to re-render multi-line input in terminal (cursor management)
- Cross-platform key binding compatibility (macOS vs Linux vs WSL)
- Visual indication that input spans multiple lines

### Complexity Drivers

- Terminal cursor position management for multi-line display
- Maintaining backwards compatibility with existing input flow
- Testing across different terminal emulators

## Acceptance Criteria

- [ ] Ctrl+J (or configured key) inserts newline in current input
- [ ] Multi-line input displays correctly in terminal
- [ ] Enter still submits the full multi-line message
- [ ] Existing readline features preserved (history, Ctrl+C)
- [ ] Works on macOS, Linux, and WSL

## Value Statement

Quick multi-line input without context switching to external editor. Lower friction for short multi-line messages.

## Dependencies

- Nice-to-have after 0003 (editor command) ships
- May require new npm dependency (`keypress` or similar)

## Effort Estimate

Medium-Large: ~4-6 hours including cross-platform testing
