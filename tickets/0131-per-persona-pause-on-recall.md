# 0131: Per-Persona Pause on Message Recall

**Status**: PENDING
**Depends on**: 0046, 0048

## Summary

When a message is recalled, pause only the affected persona instead of the entire system. Additionally, when a persona is paused, user messages sent to that persona should display a visual indicator that the message won't be processed until the persona is unpaused.

## Acceptance Criteria

### Recall Behavior
- [ ] Message recall pauses only the affected persona, not the whole system
- [ ] Other personas continue processing normally during recall
- [ ] Paused persona's status indicator reflects paused state

### Paused Persona Message Display
- [ ] User messages to a paused persona show visual indicator (e.g., icon, badge, or styling)
- [ ] Indicator clearly communicates "won't send until unpaused"
- [ ] Suggested: muted styling, pause icon, or tooltip on hover
- [ ] When persona is unpaused, indicator is removed and messages process normally

### Edge Cases
- [ ] Multiple personas can be individually paused simultaneously
- [ ] Global system pause still works as expected (pauses all)
- [ ] Unpausing a persona triggers processing of any pending messages

## Notes

- This is a refinement of ticket 0046 (recall) and 0048 (system pause)
- The `pause_until` field already exists per-persona (see Key Decisions in STATUS.md)
- Need to verify current recall implementation and update to use per-persona pause
