# 0055: Logging System Improvements

**Status**: PENDING

## Summary
Implement a robust logging system with log rotation, proper log levels, flushing, and cleanup of excessive debug statements scattered throughout the codebase.

## Problem
The current logging system has several issues:

1. **Excessive debug logging**: There are ~100+ debug statements scattered across the codebase from development/debugging sessions, many of which are no longer needed
2. **No log rotation**: The single `logs/output.log` file grows indefinitely without rotation
3. **No log levels**: Everything is logged at the same level, making it hard to filter important vs. verbose information
4. **No flushing**: Logs may not be written immediately, potentially losing data on crashes
5. **No cleanup**: Old logs accumulate without automatic cleanup
6. **Inconsistent logging**: Mix of `debugLog()` wrapper and direct `appendDebugLog()` calls

**Current logging locations:**
- `src/blessed/app.ts`: ~50+ debug statements (constructor, resize, quit command, etc.)
- `src/blessed/layout-manager.ts`: ~10+ debug statements (setup, handlers)
- `src/blessed/focus-manager.ts`: ~5+ debug statements (resize handling)
- `src/blessed/persona-renderer.ts`: ~2+ debug statements (spinner animation)
- `src/storage.ts`: Core logging functions (`initializeDebugLog`, `appendDebugLog`)

## Proposed Solution

### 1. Implement Proper Logging System
Create a new `Logger` class in `src/logger.ts` with:
- **Log levels**: ERROR, WARN, INFO, DEBUG, TRACE
- **Configurable output**: File, console, or both
- **Structured logging**: JSON format with timestamps, levels, context
- **Performance**: Async writing with buffering

### 2. Log Rotation and Cleanup
- **Size-based rotation**: Rotate when log files exceed 10MB
- **Time-based rotation**: Daily rotation for active development
- **Retention policy**: Keep last 7 days of logs, clean up older files
- **Compressed archives**: Gzip old log files to save space

### 3. Clean Up Existing Debug Statements
**Remove excessive debug logging:**
- Constructor/initialization logs (keep only errors)
- Resize event logs (too verbose)
- Input state change logs (too verbose)
- Routine operation logs (submit, render, etc.)

**Keep important debug logging:**
- Error conditions and recovery
- Critical state changes (persona switching, exit logic)
- Performance-sensitive operations
- User command processing

### 4. Implement Log Flushing
- **Immediate flushing**: For ERROR and WARN levels
- **Buffered flushing**: For INFO/DEBUG levels (flush every 1 second or 100 entries)
- **Graceful shutdown**: Flush all buffers on application exit

### 5. Environment-Based Configuration
```typescript
// Log levels by environment
const LOG_LEVELS = {
  production: 'WARN',
  development: 'DEBUG',
  test: 'ERROR'
};

// Enable/disable specific loggers
const LOGGER_CONFIG = {
  'app.resize': false,        // Too verbose
  'app.input': false,         // Too verbose  
  'app.exit': true,           // Important for debugging
  'persona.switch': true,     // Important for debugging
  'command.quit': true        // Important for debugging
};
```

## Implementation Plan

### Phase 1: Core Logger Implementation
1. Create `src/logger.ts` with Logger class
2. Implement log levels, rotation, and flushing
3. Add configuration system
4. Write unit tests for logger functionality

### Phase 2: Migration and Cleanup
1. Replace `debugLog()` calls with appropriate log levels
2. Remove excessive debug statements (constructor spam, resize events, etc.)
3. Keep critical debugging (errors, state changes, user commands)
4. Update imports across codebase

### Phase 3: Log Management
1. Implement log rotation (size and time-based)
2. Add cleanup of old log files
3. Add graceful shutdown log flushing
4. Test log rotation and cleanup

## Acceptance Criteria

### Core Logging System
- [ ] Logger class supports ERROR, WARN, INFO, DEBUG, TRACE levels
- [ ] Configurable log output (file, console, both)
- [ ] Structured JSON logging with timestamps and context
- [ ] Async writing with buffering for performance

### Log Rotation and Cleanup
- [ ] Automatic rotation when log files exceed 10MB
- [ ] Daily log rotation during active development
- [ ] Automatic cleanup of logs older than 7 days
- [ ] Compressed storage of rotated logs (gzip)

### Debug Statement Cleanup
- [ ] Remove excessive constructor/initialization logging
- [ ] Remove verbose resize and input state logging
- [ ] Keep error conditions and critical state changes
- [ ] Reduce total debug statements by ~70% (from ~100+ to ~30)

### Log Flushing and Performance
- [ ] Immediate flushing for ERROR/WARN levels
- [ ] Buffered flushing for INFO/DEBUG (1 second or 100 entries)
- [ ] Graceful shutdown flushes all buffers
- [ ] No performance impact on UI responsiveness

### Configuration and Environment
- [ ] Environment-based log level configuration
- [ ] Per-module logger enable/disable configuration
- [ ] Debug mode (`--debug`) enables DEBUG level logging
- [ ] Production mode defaults to WARN level

### Migration and Compatibility
- [ ] All existing `debugLog()` calls migrated to new system
- [ ] No breaking changes to existing functionality
- [ ] Backward compatibility during transition period
- [ ] All tests pass after migration

## Value Statement

**Developer Experience**: Clean, focused logging makes debugging easier and reduces noise in log files. Proper log levels allow developers to see only relevant information.

**System Reliability**: Log rotation and cleanup prevent disk space issues. Proper flushing ensures important error information isn't lost during crashes.

**Performance**: Async logging with buffering reduces I/O impact on UI responsiveness. Configurable logging allows disabling verbose output in production.

**Maintenance**: Structured logging and automatic cleanup reduce manual log management overhead.

## Dependencies
- None (self-contained improvement)

## Effort Estimate
**Medium (~4-6 hours)**
- Phase 1 (Logger): 2-3 hours
- Phase 2 (Migration): 1-2 hours  
- Phase 3 (Management): 1 hour

## Technical Notes

### Current Log File Analysis
```bash
# Current log file size and line count
$ wc -l logs/output.log
     103 logs/output.log

# Most common log patterns (need cleanup)
$ grep -o '\[.*\] .*' logs/output.log | head -10
[2026-01-11T17:39:52.539Z] EIApp constructor starting - Instance #1
[2026-01-11T17:39:52.558Z] Screen created - Instance #1
[2026-01-11T17:39:52.558Z] LayoutManager constructor called
[2026-01-11T17:39:52.558Z] PersonaRenderer created - Instance #1
```

### Log Rotation Strategy
- **Size trigger**: 10MB per file (reasonable for text logs)
- **Time trigger**: Daily during development (prevents huge files)
- **Retention**: 7 days (balances debugging needs vs. disk space)
- **Compression**: Gzip rotated files (text compresses ~90%)

### Performance Considerations
- **Async I/O**: Use `fs.promises` for non-blocking writes
- **Buffering**: Batch writes to reduce syscall overhead
- **Lazy initialization**: Only create log files when needed
- **Memory usage**: Limit buffer size to prevent memory leaks