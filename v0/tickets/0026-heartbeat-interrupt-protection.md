# 0026: Heartbeats Should Not Interrupt Active Processing

**Status**: CANCELLED

## Problem

When a heartbeat timer fires while a user-initiated message is being processed, the heartbeat can interrupt or kill the ongoing LLM response. This is especially problematic with:
- Slow models (Gemma can take 5+ minutes)
- Short heartbeat intervals (debug mode uses 5 min)

## Acceptance Criteria

- [ ] Heartbeat checks if persona is currently processing before firing
- [ ] If processing, heartbeat is deferred/rescheduled
- [ ] User-initiated messages always take priority over heartbeats
- [ ] No orphaned or competing LLM calls

## Technical Notes

- Check `App.tsx` heartbeat logic in `resetPersonaHeartbeat`
- Current code may already check `ps.isProcessing` but timing could be off
- Consider: should heartbeat queue behind user message, or skip entirely?

## Priority

Low for production (30+ min heartbeat), Medium for development/testing.
