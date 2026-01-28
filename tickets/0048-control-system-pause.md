# 0048: Control Area: System Pause

**Status**: DONE
**Depends on**: 0040

## Summary

System-wide pause button that stops the Processor loop and aborts current operation.

## Acceptance Criteria

- [x] Pause button in control area
- [x] Click: Toggle pause state
- [x] While paused: Red, displays pause icon, pulses slightly
- [x] While running: Normal appearance
- [x] Pause aborts current LLM operation
- [x] Activity indicator near button shows queue state
- [x] Escape key toggles pause from anywhere
- [x] Uses `Processor.abortCurrentOperation()` and `Processor.resumeQueue()`

## Notes

**V1 Backward Reference**:
- "Pauses the Processor loop, terminating current operation"
- "While paused, button displays pause icon, is red, and pulses slightly"
- "We want the user to feel like the heart of the system is stopped"

## Implementation

- Pause button in ControlArea with ⏸/▶ icons
- Escape key listener for toggle from anywhere
- CSS animation `pause-pulse` for pulsing red effect when paused
- Status indicator shows busy/paused state
- Calls `processor.abortCurrentOperation()` to pause, `processor.resumeQueue()` to resume
