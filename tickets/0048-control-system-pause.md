# 0048: Control Area: System Pause

**Status**: PENDING
**Depends on**: 0040

## Summary

System-wide pause button that stops the Processor loop and aborts current operation.

## Acceptance Criteria

- [ ] Pause button in control area
- [ ] Click: Toggle pause state
- [ ] While paused: Red, displays pause icon, pulses slightly
- [ ] While running: Normal appearance
- [ ] Pause aborts current LLM operation
- [ ] Activity indicator near button shows queue state
- [ ] Escape key toggles pause from anywhere
- [ ] Uses `Processor.abortCurrentOperation()` and `Processor.resumeQueue()`

## Notes

**V1 Backward Reference**:
- "Pauses the Processor loop, terminating current operation"
- "While paused, button displays pause icon, is red, and pulses slightly"
- "We want the user to feel like the heart of the system is stopped"
