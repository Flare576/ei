# 0017: Unread Indicators and Heartbeat Countdown Display

**Status**: DONE

## Summary

Show unread message counts and heartbeat timing in the persona list for at-a-glance status.

## Problem

Users can't tell which personas have new messages or when heartbeats will fire without switching to each one.

## Proposed Solution

### Persona List Display

```
┌─Personas─────────┐
│ > ei       2m    │  ← active, heartbeat in 2 min
│   mike* 3  15m   │  ← 3 unread, heartbeat in 15 min
│   lena     8m    │  ← no unread, heartbeat in 8 min
│   beta  ⠋       │  ← currently processing
└──────────────────┘
```

### Visual Elements

| Element | Meaning |
|---------|---------|
| `>` | Currently active persona |
| `*` | Has unread messages |
| `3` | Unread count (if > 0) |
| `2m` | Time until next heartbeat |
| `⠋` | Currently processing |

### Countdown Behavior

- Updates every ~30 seconds (don't need per-second precision)
- Shows "now" or "soon" when < 1 minute
- Resets when persona is interacted with

### Unread Tracking

```typescript
interface PersonaDisplay {
  name: string;
  isActive: boolean;
  unreadCount: number;
  heartbeatIn: number; // seconds
  isProcessing: boolean;
}
```

### Notification Behavior

When background persona sends message:
1. Increment unread count
2. Name becomes bold until viewed

No audio/bell notifications - just visual indicators. (Maybe in v900.1 we add be-boops.)

## Acceptance Criteria

- [x] Unread count shows next to persona name
- [x] Bold/asterisk indicates unread messages
- [x] Heartbeat countdown displays and updates
- [x] Processing spinner shows for active LLM calls
- [x] Switching to persona clears unread
- [x] Countdown resets on user activity

## Implementation Notes

Added `PersonaStatusInfo` interface to PersonaList.tsx with:
- `unreadCount`, `isProcessing`, `heartbeatIn` (seconds)

PersonaList now displays:
- Yellow asterisk and count for unread messages
- Animated spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) for processing personas
- Heartbeat countdown in human-readable format (soon, 2m, 1h30m)

App.tsx changes:
- Added `countdownTick` state with 30s interval refresh
- Added `personaStatusMap` useMemo that computes status from PersonaState refs
- Pass personaStatus to PersonaList in full layout

## Value Statement

At-a-glance awareness of all conversations. Know when personas will reach out without watching each one.

## Dependencies

- Ticket 0008 (multi-persona heartbeat)
- Ticket 0009 (per-persona queues for unread tracking)
- Ticket 0010 (ink layout)

## Effort Estimate

Medium: ~3-4 hours
