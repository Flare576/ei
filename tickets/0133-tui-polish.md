# 0133: TUI Polish & Robustness

**Status**: DONE
**Depends on**: 0100, 0101

## Summary

Complete the remaining polish items from the TUI skeleton and add robustness features to FileStorage.

## Acceptance Criteria

### UX Polish (from 0100i)

- [x] Auto-scroll message list to bottom on new messages
- [x] Ctrl+C signal handler to abort LLM operation instead of exiting app
- [x] PageUp/PageDown works from input area without clicking message area first
- [ ] Sidebar toggle for narrow terminals (optional)

### Logging & Notifications

- [x] Route Processor console.logs to log file (already writes to `$EI_DATA_PATH/tui.log`)
- [x] Surface errors/warnings in TUI (toast or status bar notification)
- [x] Show queue state correctly in status bar (currently always shows "Ready")

### FileStorage Robustness (from 0101)

- [x] Atomic writes: write to temp file, then rename
- [x] File locking for concurrent access safety (prevent corruption from multiple TUI instances)

## Notes

The TUI is functional for daily use. These items improve reliability and UX edge cases.

### Atomic Write Pattern

```typescript
const tempPath = `${filePath}.tmp.${Date.now()}`;
await Bun.write(tempPath, content);
await rename(tempPath, filePath);
```

### File Locking Options

1. **Advisory locks** via `flock()` (Unix) or platform-specific APIs
2. **Lock file** pattern: create `.lock` file, check before write
3. **SQLite** for storage (inherent locking, but more complex)

Recommend option 2 (lock file) for simplicity.
