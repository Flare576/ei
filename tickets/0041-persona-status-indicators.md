# 0041: Persona Panel: Status Indicators

**Status**: DONE
**Depends on**: 0014

## Summary

Add status circle indicator to persona pills showing current state: Thinking (yellow), Ready (green), Unread (red).

## Acceptance Criteria

- [x] Status circle in bottom-right of persona image
- [x] Yellow: LLM processing a response for this persona
- [x] Green: No pending work, ready for input
- [x] Red: Unread message(s) from persona
- [x] Unread count badge (optional, may be too busy)
- [x] Status updates via `onMessageProcessing`, `onMessageAdded` events
- [x] Paused personas show distinct visual state (play icon, muted color)

## Notes

**V1 Backward Reference**:
- "Status circle in bottom right - Thinking (yellow), Ready (green), unread message (red)"
- "Paused Personas display a play icon. It can be yellow, but not same urgency as system pause"

## Implementation

- Status indicator in `PersonaPanel.tsx` via `ei-persona-pill__status` class
- CSS states: `.thinking` (yellow), `.unread` (red), `.paused` (gray with play icon)
- Default state is green (ready)
- Paused avatars have reduced opacity (0.6)
- Unread badge shows count when > 0
- App.tsx tracks `processingPersona` via `onMessageProcessing` event
