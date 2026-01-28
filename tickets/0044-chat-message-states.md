# 0044: Chat Panel: Message States (pending/read)

**Status**: DONE
**Depends on**: 0043

## Summary

Visual distinction between message states: pending (gray/processing), read (normal), unread (highlighted).

## Acceptance Criteria

- [x] Human messages appear grayed until marked read
- [x] Read status changes when persona processes (even if no response)
- [x] Unread persona messages have distinct highlight
- [x] Clicking unread message marks it read
- [x] Scrolling past unread messages marks them read
- [x] Pending messages are clickable to recall (see 0046)

## Notes

**V1 Backward Reference**:
- "When a user first sends a message, it should appear immediately, grayed out until processed"
- "Once the AI responds (or chooses not to), it should be marked Read"

The `read` field on Message tracks this. Human messages get marked read when response is attempted.

## Implementation

- Added `messages_markRead()` method to PersonaState, StateManager, and Processor
- ChatPanel uses IntersectionObserver to detect when messages scroll into view
- Click handler on unread system messages marks them read
- CSS classes: `.pending` (grayed human messages), `.unread` (highlighted system messages)
- Visual styles: pending has 0.6 opacity, unread has accent border highlight
