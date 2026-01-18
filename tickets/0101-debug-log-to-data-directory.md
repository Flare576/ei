# 0101: Debug Log to Data Directory

**Status**: PENDING

## Summary
Move debug log file from project directory to data directory to prevent test runs from polluting development logs.

## Problem
Currently `debugLog()` writes to a file in the project directory. When tests run (especially E2E tests), they flood the same log file used during manual development/debugging, making it useless for diagnosing real issues.

## Solution
Write debug logs to the data directory (`EI_DATA_DIR` or default `~/.ei/data/`) instead of the project root. This keeps test logs separate from development logs since tests use isolated temp directories.

## Acceptance Criteria
- [ ] Debug log writes to `{dataDir}/debug.log` instead of project root
- [ ] Debug log respects `EI_DATA_DIR` environment variable
- [ ] Tests write to their isolated temp data directories
- [ ] Development debug logs remain in `~/.ei/data/debug.log` (or configured location)
- [ ] All tests pass

## Dependencies
None

## Effort Estimate
Small (~30 min)
