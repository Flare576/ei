# 0077: Help Command with External Pager

**Status**: DONE

## Summary
Display comprehensive help text when user types `/help` or `/h`, using an external pager (`less`) for reliable display and dismissal.

## Problem
The current `/help` command outputs to the status bar, which is a single line at the bottom of the screen. As we add more commands, the help text won't fit.

## Solution
Use `screen.exec()` to spawn `less` with help text - the same pattern used for the external editor (`Ctrl+E`). This bypasses blessed's broken focus management entirely.

### Why Not a Modal?
We initially attempted to use `blessed.message()` and `blessed.box()` as modal popups. After extensive debugging, we discovered that blessed's `textbox` widget with `inputOnFocus: true` has fundamentally broken focus management:

1. The textbox's `readInput()` mode intercepts ALL keypresses before screen-level handlers
2. `cancel()` doesn't actually stop the textbox from receiving input
3. Even hiding the textbox doesn't prevent it from capturing keystrokes into its value buffer
4. The only thing that "fixes" it is terminal resize (which recreates all widgets)

The external pager approach works perfectly because `screen.exec()` completely hands off the terminal to the child process.

### Implementation

```typescript
private showHelpModal(): void {
  const helpText = `EI - Emotional Intelligence Chat

COMMANDS
  /persona [name]     Switch persona (or list if no name)
  ...

Press q to close this help.`;

  const tmpFile = `/tmp/ei-help-${Date.now()}.txt`;
  writeFileSync(tmpFile, helpText, 'utf-8');
  
  this.screen.exec('less', [tmpFile], {}, (err) => {
    try { unlinkSync(tmpFile); } catch {}
    this.focusManager.focusInput();
    this.screen.render();
  });
}
```

## Acceptance Criteria

- [x] `/help` and `/h` display help text in external pager
- [x] Help text includes all current commands and shortcuts  
- [x] Press `q` to dismiss and return to app
- [x] Focus returns to input box after dismissal
- [x] Scrolling works (via `less` built-in)

## Testing Improvements (Bonus)

While debugging the modal approach, we improved the test infrastructure:

- [x] Created shared blessed mock utilities (`tests/helpers/blessed-mocks.ts`)
- [x] Refactored integration tests to use shared mocks (reduced duplication)
- [x] Added `exec`, `show`, `hide`, `cancel`, `listeners` to mocks

## Lessons Learned

1. **Blessed's focus management is fundamentally broken** for textbox + modal combinations
2. **External processes are more reliable** than trying to fight blessed's internal state
3. **The editor pattern (`screen.exec()`) is the right approach** for any full-screen overlay

## Dependencies
None

## Effort Estimate
Actual: ~4 hours (including extensive debugging of the modal approach that didn't work)
