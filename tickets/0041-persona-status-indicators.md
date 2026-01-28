# 0041: Persona Panel: Status Indicators

**Status**: PENDING
**Depends on**: 0014

## Summary

Add status circle indicator to persona pills showing current state: Thinking (yellow), Ready (green), Unread (red).

## Acceptance Criteria

- [ ] Status circle in bottom-right of persona image
- [ ] Yellow: LLM processing a response for this persona
- [ ] Green: No pending work, ready for input
- [ ] Red: Unread message(s) from persona
- [ ] Unread count badge (optional, may be too busy)
- [ ] Status updates via `onMessageProcessing`, `onMessageAdded` events
- [ ] Paused personas show distinct visual state (play icon, muted color)

## Notes

**V1 Backward Reference**:
- "Status circle in bottom right - Thinking (yellow), Ready (green), unread message (red)"
- "Paused Personas display a play icon. It can be yellow, but not same urgency as system pause"
