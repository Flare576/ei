# 0134: Single Instance Enforcement

**Status**: PENDING
**Depends on**: 0101 (FileStorage Implementation)
**Blocked by**: None

## Summary

Prevent multiple Ei instances from running simultaneously against the same data directory. Currently, if a user accidentally leaves a TUI session running (e.g., in a forgotten tmux pane) and starts a new one, both processes load their own in-memory state and periodically write to the same `autosaves.json`. The stale process overwrites newer data, causing message loss.

## Problem

The existing file lock in `FileStorage.withLock()` prevents simultaneous writes but does NOT prevent the stale data problem:

1. Process A starts Saturday, loads state with 18 messages
2. Process B starts Tuesday, loads state with 18 messages, user sends message #19
3. Process B saves → autosaves.json has 19 messages
4. Process A's 60-second auto-save triggers → overwrites with its stale 18-message state
5. User's message #19 is lost

## Acceptance Criteria

- [ ] On startup, acquire an exclusive lock file (`$EI_DATA_PATH/ei.lock`)
- [ ] Lock file contains PID and start timestamp for debugging
- [ ] If lock already held by another process:
  - [ ] Check if that PID is still running
  - [ ] If running: exit with clear error message ("Another Ei instance is running (PID XXXXX)")
  - [ ] If stale (process dead): steal the lock and proceed
- [ ] Lock is released on normal exit (`processor.stop()`)
- [ ] Lock is released on crash (process exit cleans up, or stale detection handles it)
- [ ] Works for both TUI and Web frontends

## Implementation Notes

### Lock File Location
```
$EI_DATA_PATH/ei.lock
```

### Lock File Format
```json
{
  "pid": 12345,
  "started": "2026-02-10T20:00:00.000Z",
  "frontend": "tui"
}
```

### Stale Lock Detection
- Read lock file
- Check if PID exists: `kill(pid, 0)` or equivalent
- If process doesn't exist, lock is stale → delete and acquire
- If process exists but started > 7 days ago, warn but don't auto-steal (edge case safety)

### Where to Implement
Option A: In `FileStorage` constructor or `isAvailable()` method
Option B: In `Processor.start()` before `stateManager.initialize()`
Option C: New `InstanceLock` class used by Processor

Recommendation: Option C - clean separation, testable, reusable.

### Edge Cases
- Ctrl+C without clean shutdown: Lock file remains, but PID check handles it
- Machine restart: Same as above
- Two users sharing same EI_DATA_PATH: Intentional conflict, error is correct
- Web + TUI simultaneously: Should be blocked (same data, same problem)

## Testing

- [ ] Unit test: Lock acquisition succeeds when no lock exists
- [ ] Unit test: Lock acquisition fails when another process holds lock
- [ ] Unit test: Stale lock (dead PID) is successfully stolen
- [ ] Integration test: Start two TUI instances, second one exits with error
