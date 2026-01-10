# 0032: Failed Message Edit and Retry Interface

**Status**: PENDING

## Summary

Add [EDIT] and [RETRY] buttons to failed messages, allowing users to fix and resubmit messages that failed due to errors or Ctrl+C abort.

## Problem

When messages fail (due to LLM errors, network issues, or user Ctrl+C abort), they're marked as failed in red but users have no way to recover. They must retype the entire message, losing their original text.

## Proposed Solution

### Visual Interface

Failed messages should show interactive buttons:

```
┌─Chat: beta──────────────────────────┐
│ [3:45 PM] You: This message failed  │  ← red text
│                [EDIT] [RETRY]       │  ← clickable buttons
│ [3:46 PM] Beta: What's up?          │
└─────────────────────────────────────┘
```

### Button Behavior

**[EDIT] Button:**
- Opens `/editor` command with the failed message content pre-loaded
- User can modify the message and resubmit
- Original failed message is replaced with the edited version
- Handles "I screwed up my message" case

**[RETRY] Button:**
- Resubmits the exact same message without changes
- Original failed message is replaced with the retry attempt
- Handles "transient LLM error" case

### Implementation Details

**Message State Transitions:**
```
Failed → [EDIT] → Processing → Sent/Failed
Failed → [RETRY] → Processing → Sent/Failed
```

**UI Interaction:**
- Buttons should be keyboard accessible (Tab to focus, Enter to activate)
- Only show buttons for the most recent failed message per persona
- Buttons disappear once user sends a new message

**Data Handling:**
- Store original message content in failed message state
- Replace failed message in history when edit/retry is triggered
- Preserve timestamp of original attempt

### Error Handling

- If `/editor` command doesn't exist yet, show error: "Editor command not available. Use /help for available commands."
- If edit/retry fails again, show new failed state with buttons
- Limit retry attempts? (Maybe 3 max to prevent infinite loops)

## Acceptance Criteria

- [ ] Failed messages show [EDIT] and [RETRY] buttons
- [ ] [EDIT] button opens `/editor` with failed message content
- [ ] [RETRY] button resubmits the same message
- [ ] Buttons are keyboard accessible (Tab + Enter)
- [ ] Only most recent failed message per persona shows buttons
- [ ] Original failed message is replaced when edit/retry is triggered
- [ ] Error handling when `/editor` command unavailable
- [ ] Buttons disappear when user sends new message

## Value Statement

Eliminates frustration of losing message content on failures. Users can quickly recover from errors without retyping, improving the conversational flow.

## Dependencies

- Ticket 0030 (Ink Editor Command) - for [EDIT] functionality
- Ticket 0014 (Message State Visualization) - failed state already implemented

## Effort Estimate

Medium: ~3-4 hours (UI interaction, state management, editor integration)

## Technical Notes

- Will need to extend `Message` interface to store original content for failed messages
- Button rendering in ChatHistory component using Ink's `useInput` for keyboard handling
- Integration with existing `/editor` command when available
- Consider using Ink's focus management for button navigation