# 0037: Blessed Debug Output Log-Only Mode

**Status**: VALIDATED

## Summary
Debug output in blessed UI breaks the status line layout when multi-line text wraps, causing application corruption. Move all debug output to log files only.

## Problem
When running in debug mode (`--debug` or `-d`), debug messages are displayed in the status line area at the bottom of the screen. Multi-line debug output causes text wrapping that breaks the entire blessed UI layout.

**Current behavior:**
- Debug output appears in status line
- Multi-line debug messages wrap and corrupt the UI
- Application becomes unusable when debug output is verbose

## Proposed Solution
1. **Remove debug output from status line**: Never display debug messages in the UI
2. **Log file consolidation**: Change from `debug-scroll.log` to `logs/output.log`
3. **All debug to file**: Ensure all debug output goes to log file only
4. **Clean status line**: Status line only shows user-relevant information (thinking indicators, command feedback, etc.)

## Implementation Details

**File changes needed:**
- Update `src/storage.ts`: Change log file path from `debug-scroll.log` to `logs/output.log`
- Update `src/blessed/app.ts`: Remove any debug output from status rendering
- Ensure `debugLog()` calls only write to file, never to UI

**Log directory structure:**
```
logs/
  output.log    # All debug output (replaces debug-scroll.log)
```

## Acceptance Criteria
- [x] Debug mode no longer displays debug output in UI status line
- [x] All debug output goes to `logs/output.log` instead of `debug-scroll.log`
- [x] Status line only shows user-relevant information (thinking, command feedback)
- [x] UI layout remains stable in debug mode with verbose output
- [x] Log file is created in `logs/` directory (create if doesn't exist)
- [x] Debug output includes timestamps and is properly formatted for file reading

## Implementation Details
**Files changed:**
- `src/storage.ts`: Updated debug log path from `debug-scroll.log` to `logs/output.log`, added logs directory creation
- `src/blessed/app.ts`: Fixed `/persona` command output to use single-line format instead of multi-line (which was breaking status line layout)

**Root cause:** The issue wasn't debug output per se, but the `/persona` command showing multi-line persona lists in the status line, causing layout corruption.

## Value Statement
Prevents UI corruption in debug mode while maintaining full debug logging capability for development and troubleshooting.

## Dependencies
None - this is a blessed-specific UI stability fix.

## Effort Estimate
Small (~1-2 hours) - straightforward file path changes and UI cleanup.