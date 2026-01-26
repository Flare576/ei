# 0076: Persist Unread Message Counts Across Sessions

**Status**: DONE

## Summary

Persist unread message indicators to disk so users see "3 unread from Mike" after app restart, not just during a single session.

## Problem

Currently, unread counts are tracked in-memory only (`app.ts` lines 78, 894-895, 1010-1011). When the app restarts:
- All personas show 0 unread messages
- Background persona responses from the previous session appear "read"
- User loses awareness of which conversations had new activity

## Proposed Solution

Reuse the existing `read` field on `Message` (currently only used for human messages to track LLM processing) to also track whether the human has **seen** system messages.

### Implementation Plan

#### Step 1: Mark system messages as unread when written (processor.ts)

In `processor.ts` line ~129, add `read: false` to system messages:

```typescript
await appendMessage({
  role: "system",
  content: response,
  timestamp: new Date().toISOString(),
  read: false,  // NEW: human hasn't seen this yet
}, persona);
```

**Note**: The `appendMessage` function (storage.ts:194) doesn't currently set a default for `read` on system messages, so we need to explicitly pass it.

#### Step 2: Add storage helper to get unread count (storage.ts)

```typescript
export async function getUnreadSystemMessageCount(persona?: string): Promise<number> {
  const history = await loadHistory(persona);
  return history.messages.filter(
    (m) => m.role === "system" && m.read === false
  ).length;
}
```

#### Step 3: Add storage helper to mark system messages as read (storage.ts)

```typescript
export async function markSystemMessagesAsRead(persona?: string): Promise<void> {
  const history = await loadHistory(persona);
  let changed = false;
  for (const msg of history.messages) {
    if (msg.role === "system" && msg.read === false) {
      msg.read = true;
      changed = true;
    }
  }
  if (changed) {
    await saveHistory(history, persona);
  }
}
```

#### Step 4: Load unread counts on startup (app.ts)

In `initializePersonas()` or similar, for each persona:

```typescript
const unreadCount = await getUnreadSystemMessageCount(personaName);
if (unreadCount > 0) {
  const ps = this.getOrCreatePersonaState(personaName);
  ps.unreadCount = unreadCount;
  this.unreadCounts.set(personaName, unreadCount);
}
```

#### Step 5: Mark messages read on persona switch (app.ts)

In `switchToPersona()` around line 1176, after setting unreadCount to 0:

```typescript
ps.unreadCount = 0;
this.unreadCounts.delete(personaName);
await markSystemMessagesAsRead(personaName);  // NEW: persist to disk
```

#### Step 6: Remove redundant in-memory tracking (app.ts)

Once persistent tracking works, the in-memory `unreadCounts` Map (line 78) becomes a cache of persisted state rather than the source of truth. The increment logic at lines 894-895 and 1010-1011 should continue to work for real-time updates during the session.

**Decision point**: Keep the Map as a performance cache (avoids disk reads on every render) or remove it entirely and always read from disk. Recommendation: keep it as cache, initialize from disk on startup.

### Semantic Note

The `read` field will now have different meanings based on role:
- **Human messages**: `read: false` = LLM hasn't processed this message yet
- **System messages**: `read: false` = Human hasn't seen this message yet

This is acceptable because existing code always filters by role when checking `read` (e.g., `m.role === "human" && m.read === false`). No semantic conflict occurs.

## Acceptance Criteria

- [x] System messages saved with `read: false` in processor.ts
- [x] New `getUnreadSystemMessageCount()` function in storage.ts
- [x] New `markSystemMessagesAsRead()` function in storage.ts
- [x] Unread counts loaded from disk on app startup
- [x] Switching to persona marks its system messages as read (persisted)
- [x] After restart, unread counts reflect actual unseen messages
- [x] Existing in-memory increment logic still works for real-time updates

### Backward Compatibility Note

Messages without the `read` field (existing history) are treated as read via strict equality check (`m.read === false`). No data migration required.

## Value Statement

Users can close the app overnight, and when they return, they immediately see which personas sent messages while they were away.

## Dependencies

- Ticket 0009 (per-persona queues) - DONE
- Ticket 0017 (unread display) - DONE

## Effort Estimate

Small-Medium: ~2-3 hours

## Files to Modify

- `src/processor.ts` - Add `read: false` to system message writes
- `src/storage.ts` - Add two new helper functions
- `src/blessed/app.ts` - Load on startup, persist on switch
