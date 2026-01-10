# 0014: Message State Visualization

**Status**: VALIDATED

## Summary

Visually indicate message states (sent, processing, queued) in the chat history.

## Problem

Currently no visual feedback between sending a message and receiving a response. Users don't know if their message was received or if the system is working.

## Proposed Solution

### Message States

| State | Visual | Meaning |
|-------|--------|---------|
| Sent | Normal color | Delivered and processed |
| Processing | Gray + spinner | LLM is generating response |
| Queued | Gray, no spinner | Waiting behind other messages |
| Failed | Red + [EDIT] [RETRY] | Error occurred, user can fix or retry |

### Visual Rendering

```
┌─Chat: ei─────────────────────────────┐
│ [3:45 PM] You: Hey there             │  ← normal (white)
│ [3:45 PM] EI: What's up?             │  ← normal
│ [3:46 PM] You: Working on something  │  ← gray + ⠋ spinner
│ [3:46 PM] You: Also this             │  ← gray (queued)
└──────────────────────────────────────┘
```

### State Transitions

```
User sends → Queued (if processing) or Processing (if idle)
LLM starts → Processing
LLM completes → Sent
Error occurs → Failed
```

### Failed Message Handling

When a message fails, show two options:
- **[EDIT]**: Opens `/editor` with the failed message content, allowing user to fix and resubmit
- **[RETRY]**: Resubmit the same message as-is

This handles both "I screwed up my message" and "transient LLM error" cases.

### Data Model

```typescript
interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  state: "sent" | "processing" | "queued" | "failed";
  persona: string;
}
```

### Stacking Queued Messages

Multiple queued messages from user should visually stack:
```
│ [3:46 PM] You: First thing           │  ← processing
│           Also second thing          │  ← queued (grouped)
│           And third                  │  ← queued (grouped)
```

## Acceptance Criteria

- [x] Processing messages show spinner animation
- [x] Queued messages appear gray without spinner
- [x] State updates in real-time as processing completes
- [ ] Multiple queued messages stack visually
- [x] Completed messages transition to normal color
- [ ] Failed messages show red with [EDIT] [RETRY] buttons
- [ ] [EDIT] button opens editor with failed message content
- [ ] [RETRY] button resubmits the same message

## Value Statement

Clear feedback loop. Users always know what's happening with their messages.

## Dependencies

- Ticket 0010 (basic ink layout)
- Ticket 0009 (per-persona queues for state tracking)

## Effort Estimate

Medium: ~3-4 hours
