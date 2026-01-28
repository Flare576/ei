# 0044: Chat Panel: Message States (pending/read)

**Status**: PENDING
**Depends on**: 0043

## Summary

Visual distinction between message states: pending (gray/processing), read (normal), unread (highlighted).

## Acceptance Criteria

- [ ] Human messages appear grayed until marked read
- [ ] Read status changes when persona processes (even if no response)
- [ ] Unread persona messages have distinct highlight
- [ ] Clicking unread message marks it read
- [ ] Scrolling past unread messages marks them read
- [ ] Pending messages are clickable to recall (see 0046)

## Notes

**V1 Backward Reference**:
- "When a user first sends a message, it should appear immediately, grayed out until processed"
- "Once the AI responds (or chooses not to), it should be marked Read"

The `read` field on Message tracks this. Human messages get marked read when response is attempted.
