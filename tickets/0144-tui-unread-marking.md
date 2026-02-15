# 0144: TUI Unread Message Marking

**Status**: PENDING
**Depends on**: 0100 (TUI Frontend Skeleton)
**Priority**: Medium (TUI V1.2)

## Summary

Implement automatic marking of messages as read in the TUI. Currently the Sidebar displays `unread_count` but nothing ever marks messages as read, so the count never decreases.

## Background

From tui-map.md:
```yaml
- markMessageRead
    * Builtin on "read" if possible, otherwise only markAllMessagesRead
- markAllMessagesRead
    * Builtin on having persona active for > 5 seconds
```

The web frontend uses IntersectionObserver to mark individual messages as they scroll into view, plus marks all read when leaving a persona. The TUI needs equivalent behavior.

## Acceptance Criteria

### Mark All Read on Dwell (Required)

- [ ] When a persona has been active for 5+ seconds, call `markAllMessagesRead`
- [ ] Timer resets when switching personas
- [ ] Timer cancelled if user switches away before 5 seconds
- [ ] After marking, `unread_count` in sidebar updates to 0

### Mark All Read on Leave (Required)

- [ ] When switching away from a persona, mark all messages read immediately
- [ ] This handles the case where user reads quickly and switches

### Visual Feedback (Optional)

- [ ] Unread messages could have distinct styling (accent border, highlight)
- [ ] Styling clears after messages are marked read
- [ ] This mirrors web behavior from ticket 0044

## Technical Design

### EiContext Changes

```typescript
// tui/src/context/ei.tsx

// Add to EiContextValue interface:
markAllMessagesRead: (personaName: string) => Promise<void>;

// Add implementation:
const markAllMessagesRead = async (personaName: string) => {
  if (!processor) return;
  await processor.markAllMessagesRead(personaName);
  await refreshPersonas(); // Updates unread_count in sidebar
};

// Modify selectPersona to handle marking:
let readTimer: Timer | null = null;

const selectPersona = (name: string) => {
  // Mark previous persona's messages as read
  const previous = store.activePersona;
  if (previous && processor) {
    processor.markAllMessagesRead(previous);
  }
  
  // Cancel any pending timer
  if (readTimer) {
    clearTimeout(readTimer);
    readTimer = null;
  }
  
  // Set new persona
  setStore("activePersona", name);
  if (processor) {
    processor.getMessages(name).then((msgs) => setStore("messages", msgs));
  }
  
  // Start 5-second dwell timer
  readTimer = setTimeout(async () => {
    if (store.activePersona === name && processor) {
      await processor.markAllMessagesRead(name);
      await refreshPersonas();
    }
    readTimer = null;
  }, 5000);
};

// Clean up timer on unmount
onCleanup(() => {
  if (readTimer) clearTimeout(readTimer);
  processor?.stop();
});
```

### Edge Cases

1. **Rapid switching**: If user switches personas quickly (< 5s), only mark-on-leave fires
2. **Same persona re-select**: Timer restarts (harmless, marking read twice is idempotent)
3. **No messages**: `markAllMessagesRead` on empty conversation is a no-op

## File Changes

```
tui/src/
└── context/
    └── ei.tsx           # Add markAllMessagesRead, dwell timer, mark-on-leave
```

## Testing

### Prerequisites

- [ ] Run `npm run test:all` from project root - all tests must pass
- [ ] Run `npm run test:e2e` from `tui/` - all TUI E2E tests must pass

### Unit Tests

- [ ] Timer fires after 5 seconds of persona being active
- [ ] Timer cancelled when switching before 5 seconds
- [ ] Previous persona marked read on switch

### E2E Tests

- [ ] Select persona with unread messages, wait 6 seconds, sidebar shows 0 unread
- [ ] Select persona with unread messages, switch away after 2 seconds, sidebar shows 0 unread
- [ ] Rapid switching between personas doesn't cause errors

### Post-Implementation

- [ ] Run `npm run test:all` - all tests still pass
- [ ] Run `npm run test:e2e` from `tui/` - all tests pass including new ones

## Notes

- The 5-second dwell time matches web behavior and prevents marking read on accidental clicks
- `markAllMessagesRead` is simpler than per-message marking and sufficient for TUI
- Per-message marking with scroll detection could be a future enhancement but adds complexity
- The Processor already has `markAllMessagesRead` - we just need to call it
