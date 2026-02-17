# 0144: TUI Unread Message Marking

**Status**: DONE
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

The web frontend uses IntersectionObserver to mark individual messages as they scroll into view, plus marks all read when leaving a persona. The TUI uses a simpler approach based on dwell time and user actions.

## Acceptance Criteria

### Mark All Read on Dwell (Required)

- [ ] When a persona has been active for 5+ seconds, call `markAllMessagesRead`
- [ ] Timer resets when switching personas
- [ ] Timer cancelled if user switches away before 5 seconds
- [ ] After marking, `unread_count` in sidebar updates to 0

### Mark All Read on Leave (Required)

- [ ] When switching away from a persona **after dwelling 5+ seconds**, mark messages read
- [ ] Quick switches (< 5s) do NOT mark previous persona as read
- [ ] This prevents accidental tab-throughs from marking everything read

### Mark All Read on Send (Required)

- [ ] When user sends a message, immediately mark all messages read for that persona
- [ ] Rationale: If they're typing, they're engaged—no need to wait for dwell timer

### Visual Feedback (Deferred)

Visual styling for unread messages deferred to ticket 0149 (Markdown Rendering).
Need markdown/styling infrastructure first before adding unread indicators.

## Technical Design

### EiContext Changes

```typescript
// tui/src/context/ei.tsx

// Track dwell state for mark-on-leave logic
let readTimer: Timer | null = null;
let dwelledPersona: string | null = null;  // Set after 5s dwell

const selectPersona = (name: string) => {
  // Mark previous persona as read ONLY if we dwelled there 5+ seconds
  const previous = store.activePersona;
  if (previous && previous === dwelledPersona && processor) {
    processor.markAllMessagesRead(previous);
    refreshPersonas();
  }
  
  // Cancel any pending timer and reset dwell tracking
  if (readTimer) {
    clearTimeout(readTimer);
    readTimer = null;
  }
  dwelledPersona = null;
  
  // Set new persona (existing logic)
  setStore("activePersona", name);
  setStore("messages", []);
  const persona = store.personas.find(p => p.name === name);
  setStore("activeContextBoundary", persona?.context_boundary);
  setContextBoundarySignal(persona?.context_boundary);
  if (processor) {
    processor.getMessages(name).then((msgs) => {
      setStore("messages", [...msgs]);
    });
  }
  
  // Start 5-second dwell timer
  readTimer = setTimeout(async () => {
    if (store.activePersona === name && processor) {
      dwelledPersona = name;  // Mark that we've dwelled
      await processor.markAllMessagesRead(name);
      await refreshPersonas();
    }
    readTimer = null;
  }, 5000);
};

// sendMessage: Mark read immediately when user sends
const sendMessage = async (content: string) => {
  const current = store.activePersona;
  if (!current || !processor) return;
  
  // Mark all read immediately - user is clearly engaged
  await processor.markAllMessagesRead(current);
  dwelledPersona = current;  // Also set dwelled so leave-marking works
  
  await processor.sendMessage(current, content);
  await refreshPersonas();
};

// Clean up timer on unmount
onCleanup(() => {
  if (readTimer) clearTimeout(readTimer);
  processor?.stop();
});
```

### Edge Cases

1. **Rapid switching**: Quick switches (< 5s) don't mark previous persona as read
2. **Same persona re-select**: Timer restarts, harmless (marking read twice is idempotent)
3. **No messages**: `markAllMessagesRead` on empty conversation is a no-op
4. **Send before dwell**: Sending a message immediately marks read and sets dwelled state

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

### Manual Testing

- [ ] Select persona with unread messages, wait 6 seconds → sidebar shows 0 unread
- [ ] Select persona with unread messages, switch away after 2 seconds → sidebar still shows unread count
- [ ] Select persona, wait 6 seconds, switch away → previous persona marked read (leave-after-dwell)
- [ ] Select persona, send a message immediately → sidebar shows 0 unread
- [ ] Rapid tab-through personas → no errors, unreads preserved

### Post-Implementation

- [ ] Run `npm run test:all` - all tests still pass
- [ ] Run `npm run test:e2e` from `tui/` - all tests pass

## Notes

- The 5-second dwell time matches web behavior and prevents marking read on accidental clicks
- `markAllMessagesRead` is simpler than per-message marking and sufficient for TUI
- Per-message marking with scroll detection could be a future enhancement but adds complexity
- The Processor already has `markAllMessagesRead` - we just need to call it
- Mark-on-send provides immediate feedback for engaged users
