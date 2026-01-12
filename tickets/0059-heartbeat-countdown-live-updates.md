# 0059: Heartbeat Countdown Live Updates

**Status**: PENDING

## Summary
Fix heartbeat countdown display to automatically re-render when any persona's countdown crosses a minute threshold, eliminating the misleading static display that makes heartbeats appear broken.

## Problem
The heartbeat countdown display in the persona panel only updates when `render()` is called by user interactions. This creates a misleading UX where:

1. Countdown shows "1m" remaining
2. User waits but sees no change (no render triggered)
3. Actual heartbeat fires correctly at 30 minutes
4. UI still shows "1m" until next user interaction
5. Users think heartbeats are broken when they're actually working fine

**Root Cause**: `src/blessed/persona-renderer.ts` line 61 calculates countdown only during renders, but renders don't happen automatically on time boundaries.

## Proposed Solution
Implement automatic re-rendering when any persona's heartbeat countdown crosses a minute threshold:

1. **Calculate next minute boundary** for all active personas
2. **Set a single setTimeout** to the nearest boundary
3. **Trigger render** when timeout fires
4. **Recalculate and reschedule** for next boundary
5. **Clear timeout** when app shuts down

This ensures the countdown display stays accurate without wasteful continuous polling.

## Technical Implementation
- Add `countdownUpdateTimer` to App class
- Create `scheduleNextCountdownUpdate()` method
- Calculate `Math.min()` of all persona next-minute boundaries
- Call `render()` and reschedule when timer fires
- Clear timer in cleanup/shutdown

## Acceptance Criteria
- [ ] Heartbeat countdown displays update automatically every minute
- [ ] No unnecessary renders (only at minute boundaries)
- [ ] Single timer manages all personas efficiently
- [ ] Timer is properly cleaned up on app shutdown
- [ ] Countdown accuracy matches actual heartbeat firing
- [ ] No performance impact from continuous polling

## Value Statement
Eliminates user confusion about "broken" heartbeats and provides accurate real-time feedback on persona activity timing.

## Dependencies
None - this is a pure UI timing fix.

## Effort Estimate
Small (~1-2 hours) - straightforward timer logic addition to existing render system.