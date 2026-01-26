# 0042: Pause/Resume Active Persona with Message Queuing

**Status**: DONE

## Summary
Allow users to pause the active persona for a specified duration (or indefinitely), queue messages during pause, and automatically resume with immediate heartbeat.

## Problem
Users need the ability to temporarily stop a persona from processing messages or sending heartbeats without losing context or pending messages. Current system doesn't support pausing persona activity or queuing messages for later processing.

## Proposed Solution
Implement `/pause [duration]` and `/resume` commands with persistent message queuing:

```typescript
// New persona state fields
interface PersonaState {
  isPaused: boolean;
  pauseUntil?: Date;
  pendingMessages: Message[];
}

// Command implementations
/pause [30m|2h|indefinite]  // Default: indefinite
/resume [persona]           // Default: active persona
```

**Key behaviors:**
- Paused personas don't process heartbeats or new messages
- Messages sent to paused personas are queued, not processed
- Resume triggers immediate heartbeat with queued messages
- Pause state persists across app restarts
- Sending messages doesn't auto-resume (explicit resume required)

## Acceptance Criteria
- [x] `/pause` command pauses active persona indefinitely by default
- [x] `/pause 30m` pauses for 30 minutes, auto-resumes with heartbeat
- [x] `/pause 2h` supports hour-based durations
- [x] Paused personas don't trigger heartbeats or process messages
- [x] Messages sent to paused personas are queued in `messageQueue` array
- [x] `/resume` immediately processes all queued messages and triggers heartbeat
- [x] Pause state persists in persona storage across app restarts
- [x] Auto-resume after duration triggers immediate heartbeat
- [x] Paused personas show visual indicator in persona list
- [x] `/help` command documents pause/resume syntax and behavior

## Implementation Notes
- Pause state stored in `system.jsonc` (isPaused, pauseUntil fields on ConceptMap)
- Visual indicator: yellow `⏸` prefix + countdown timer for timed pauses
- Queued message count shown in yellow when messages pending
- Auto-resume handles case where app was closed during pause period
- Concept processing now requires messages to be `read: true` by both entities

## Test Coverage
- **Unit tests**: Updated `storage.test.ts` with filtering logic for `read` flag
- **E2E tests**: New `pause-resume.e2e.test.ts` with 11 tests covering all acceptance criteria

## Value Statement
Enables users to control conversation flow and timing, essential for managing multiple personas and preventing unwanted interruptions during focused work.

## Dependencies
- None (builds on existing persona state management)

## Effort Estimate
Medium (~3-4 hours)
