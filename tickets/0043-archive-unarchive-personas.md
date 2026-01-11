# 0043: Archive/Unarchive Personas

**Status**: PENDING

## Summary
Allow users to archive personas to hide them from the active list and disable heartbeats, with ability to view archived personas and restore them.

## Problem
Users accumulate personas over time but may only want to actively engage with a subset. Inactive personas still show in lists and consume heartbeat cycles, cluttering the interface and creating unnecessary background activity.

## Proposed Solution
Implement archive system with concept map integration:

```typescript
// Add to persona metadata
interface PersonaMetadata {
  isArchived: boolean;
  archivedDate?: Date;
}

// Command implementations
/archive [persona]     // Default: active persona
/unarchive            // Shows archived persona list
/unarchive <persona>  // Restores specific persona
```

**Key behaviors:**
- Archived personas don't appear in main persona list
- Archived personas don't trigger heartbeats
- Archive status recorded in persona's concept map
- Unarchive without args shows numbered list of archived personas
- Unarchive with name/number restores persona to active state

## Acceptance Criteria
- [ ] `/archive` marks active persona as archived in concept map
- [ ] `/archive <name>` archives specified persona by name
- [ ] Archived personas don't appear in main persona list UI
- [ ] Archived personas don't trigger heartbeat timers
- [ ] `/unarchive` shows numbered list of archived personas with names
- [ ] `/unarchive <name>` restores persona by name to active state
- [ ] `/unarchive <number>` restores persona by list position
- [ ] Archive status persists in persona storage
- [ ] Archived personas maintain all chat history and concept data
- [ ] `/help` command documents archive/unarchive syntax

## Value Statement
Reduces UI clutter and system overhead by allowing users to temporarily retire personas while preserving their complete state for future reactivation.

## Dependencies
- None (uses existing persona storage and concept map system)

## Effort Estimate
Small (~1-2 hours)