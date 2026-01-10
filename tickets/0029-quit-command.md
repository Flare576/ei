# 0029: /quit Command with Force Option

**Status**: PENDING

## Summary

Add `/quit` slash command that follows the same exit logic as Ctrl+C, with optional `--force` flag for automated testing.

## Problem

Currently, the only way to exit EI is via Ctrl+C keyboard shortcut. For automated testing and scripting, we need a command-based exit mechanism that can be reliably triggered programmatically.

## Proposed Solution

Add `/quit` command that replicates the exact Ctrl+C priority logic:

### Standard `/quit` Behavior

1. **Active persona processing** → Abort current operation, stay in app
2. **Input has text** → Clear input, stay in app  
3. **Background processing + no warning shown** → Show warning, stay in app
4. **Warning shown OR no conditions met** → Exit app

### Force Option `/quit --force`

Bypass all safety checks and exit immediately. Essential for automated testing where we need guaranteed termination.

### Implementation

```typescript
case "quit":
case "q": {
  const isForce = args.trim() === "--force";
  
  if (isForce) {
    cleanupAllPersonaStates();
    exit();
    return true;
  }
  
  // Replicate exact Ctrl+C logic
  const activePs = personaStatesRef.current.get(activePersonaRef.current);
  
  if (activePs?.isProcessing) {
    abortPersonaOperation(activePersonaRef.current);
    setStatus("Aborted current operation");
    return true;
  }

  if (state.inputHasText) {
    setState(s => ({ 
      ...s, 
      inputClearTrigger: s.inputClearTrigger + 1,
      statusMessage: "Input cleared"
    }));
    return true;
  }

  const backgroundProcessing = getBackgroundProcessingPersonas();
  if (backgroundProcessing.length > 0 && !state.ctrlCWarningShown) {
    const names = backgroundProcessing.join(", ");
    setState(s => ({ 
      ...s, 
      ctrlCWarningShown: true,
      statusMessage: `Processing in progress for: ${names}. Use /quit --force to exit immediately.`
    }));
    return true;
  }

  cleanupAllPersonaStates();
  exit();
  return true;
}
```

## Acceptance Criteria

- [ ] `/quit` follows exact same priority logic as Ctrl+C
- [ ] `/quit --force` bypasses all checks and exits immediately
- [ ] `/q` works as shorthand alias
- [ ] Warning message mentions `/quit --force` option
- [ ] `/help` updated to show quit commands
- [ ] Command works from any input state (focused/unfocused)

## Value Statement

Enables automated testing and scripting. Provides command-based alternative to keyboard shortcuts for accessibility and programmatic control.

## Dependencies

None - extends existing slash command infrastructure.

## Effort Estimate

Small: ~1 hour

## Testing Notes

This ticket is specifically designed to enable automated end-to-end testing where agents can:
1. Start the application
2. Send commands via stdin
3. Reliably terminate with `/quit --force`
4. Capture and verify outputs