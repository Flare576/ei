# 0048: Unified State Management System (Undo + Save/Restore)

**Status**: PENDING

## Summary
Implement unified state management system with automatic in-memory undo ring buffer and user-initiated disk saves. All file mutations trigger automatic snapshots, enabling rollback and safe experimentation.

## Problem
Users need the ability to:
- Undo unwanted changes (LLM responses, concept updates, configuration changes)
- Save known-good states for backup/recovery
- Restore previous states for experimentation
- Manage state across app restarts

With async concept processing, groups, and cross-persona visibility, state changes are now system-wide (affecting human concepts and all personas), making atomic undo/restore critical.

## Proposed Solution

### Unified Architecture
Single snapshot mechanism serves both in-memory undo and disk saves:

```typescript
interface SystemSnapshot {
  timestamp: string;
  humanConcepts: ConceptMap;      // data/human.jsonc
  personas: {
    [personaName: string]: {
      system: ConceptMap;           // includes pause/archive/groups/model
      history: ConversationHistory; // includes pending messages
    }
  };
}
```

### In-Memory Undo Ring (Automatic)
- Before ANY write to `human.jsonc`, `system.jsonc`, or `history.jsonc`: capture snapshot
- Ring buffer holds last 10 snapshots (oldest rolls off)
- Lost on app restart (expected behavior)
- Triggers: LLM calls, concept decay, persona creation, config changes (`/model`, `/group`, `/nick`, `/pause`, `/archive`)

### Disk Saves (User-Initiated)
- `/saveState [name]` captures current live state to `.ei-states/`
- Max 10 disk saves, oldest rolls off
- Persists across restarts
- Simple JSON files (easier to implement than ZIP, allows metadata)

### State Storage Structure
```
data/
  .ei-states/
    index.jsonc          # Metadata for all saved states
    state-001.jsonc      # Full system snapshot
    state-002.jsonc
    ...
    state-010.jsonc      # Max 10
```

**index.jsonc format:**
```json
{
  "states": [
    {
      "id": "state-001",
      "name": "Before major refactor",
      "timestamp": "2026-01-18T20:00:00Z"
    }
  ]
}
```

### Commands

#### `/undo [n]`
- Rolls back `n` snapshots from in-memory ring (default: 1)
- Restores entire system state (all personas + human concepts)
- Writes snapshot to disk, reloads UI
- Status: "Undid 3 actions, restored to [timestamp]"
- Edge case: If `n` exceeds available snapshots, undo all available and warn

#### `/saveState [name]`
- Captures **current live state** (what's on disk now)
- Writes to `.ei-states/state-XXX.jsonc`
- Updates `.ei-states/index.jsonc`
- Rolls off oldest if >10 saves
- Status: "State saved: [name] ([timestamp])"

#### `/restoreState [name|#]`
- No args: Opens `less` with formatted list from `index.jsonc`
- With arg: Restores specified state
  - Auto-captures snapshot before restore (undo-able)
  - Writes restored state to disk
  - Reloads UI
- Status: "Restored state: [name] ([timestamp])"

## Implementation Phases

### Phase 1: Snapshot Infrastructure
- [ ] Create `src/state-manager.ts` with `StateManager` class
- [ ] Implement `createSnapshot()` - serialize all persona files + human concepts
- [ ] Implement `restoreSnapshot()` - write snapshot back to disk
- [ ] Implement in-memory ring buffer (array, max 10, FIFO rolloff)
- [ ] Add snapshot trigger wrapper for all `storage.ts` write functions

### Phase 2: UI Reload Mechanism (Critical)
- [ ] Add `reloadFromDisk()` method to `EIApp`:
  - Reload `this.personas` from disk
  - Reload `this.messages` for active persona
  - Clear and rebuild `this.personaStates`
  - Clear and rebuild `this.unreadCounts`
  - Handle case where active persona no longer exists (switch to 'ei')
  - Re-render UI and scroll to bottom
- [ ] Test: create persona → undo → verify persona gone from UI

### Phase 3: Undo Command
- [ ] Add `/undo [n]` command handler in `app.ts`
- [ ] Implement snapshot pop logic (remove from ring, return state to restore)
- [ ] Call `restoreSnapshot()` then `reloadFromDisk()`
- [ ] Status message with timestamp/action count
- [ ] Handle edge cases: no snapshots, n > available
- [ ] Abort any in-progress LLM operations before undo

### Phase 4: Disk Persistence
- [ ] Create `.ei-states/` directory on init
- [ ] Implement `index.jsonc` metadata management (read/write/update)
- [ ] Add `/saveState [name]` command
- [ ] Implement rolloff logic (max 10, delete oldest files)
- [ ] Generate unique IDs for state files (timestamp-based or sequential)

### Phase 5: Restore Command
- [ ] Add `/restoreState` with no args: generate formatted list, write to temp file, open in `less`
- [ ] Add `/restoreState <name>` - find by name in index
- [ ] Add `/restoreState <#>` - find by list position
- [ ] Auto-snapshot before restore (so restore is undo-able)
- [ ] Call `restoreSnapshot()` then `reloadFromDisk()`
- [ ] Handle errors: file not found, corrupted JSON, missing personas

### Phase 6: Integration & Polish
- [ ] Update `/help` with undo/save/restore documentation
- [ ] Add snapshot capture to all write paths (verify coverage)
- [ ] Test full cycle: message → undo → saveState → quit → restart → restoreState
- [ ] Verify snapshot triggers fire on: LLM calls, decay, persona creation, config changes
- [ ] Performance check: snapshot creation time, memory usage with 10 snapshots

## Acceptance Criteria

### Undo System
- [ ] Snapshot captured before every file write operation
- [ ] `/undo` rolls back last action (all personas + human concepts)
- [ ] `/undo 3` rolls back 3 actions
- [ ] Undo ring maintains max 10 snapshots (FIFO)
- [ ] Undo restores entire system state and reloads UI
- [ ] Visual feedback: "Undid N actions, restored to [timestamp]"
- [ ] Undo lost on app restart (expected)
- [ ] Cannot undo beyond available history (shows error)

### Save/Restore System
- [ ] `/saveState` saves current state to `.ei-states/state-XXX.jsonc`
- [ ] `/saveState <name>` saves with user-provided name
- [ ] `/restoreState` opens `less` with numbered list
- [ ] `/restoreState <name>` restores by name
- [ ] `/restoreState <#>` restores by list position
- [ ] Max 10 saved states, oldest rolls off
- [ ] Auto-snapshot before restore (restore is undo-able)
- [ ] Restore reloads UI correctly (all personas, messages, unread counts)
- [ ] States persist across app restarts

### Edge Cases
- [ ] Undo during LLM processing: abort operation first
- [ ] Restore deletes active persona: switch to 'ei' after reload
- [ ] Corrupted state file: show error, don't crash
- [ ] Empty undo ring: show "No undo history available"
- [ ] State file not found: show "State '[name]' not found"

### Documentation
- [ ] `/help` documents all three commands
- [ ] Help explains in-memory vs disk saves
- [ ] Help clarifies undo is lost on restart

## Value Statement
Provides safety net for experimentation, enables backup/recovery, and allows users to manage complex multi-persona states. Unified design ensures consistency between undo and restore operations.

## Dependencies
- Existing persona state management
- File I/O utilities in `storage.ts`
- UI reload capability in `app.ts`

## Effort Estimate
Very Large (~10-12 hours)

## Implementation Notes

### Snapshot Capture Pattern
Wrap all `storage.ts` write functions:
```typescript
// Before (existing)
export async function saveConceptMap(map: ConceptMap, persona?: string): Promise<void> {
  // ... write to disk
}

// After (with snapshot)
export async function saveConceptMap(map: ConceptMap, persona?: string): Promise<void> {
  await captureSnapshot(); // Centralized snapshot trigger
  // ... write to disk
}
```

### UI Reload Pattern
```typescript
private async reloadFromDisk(): Promise<void> {
  this.personas = await listPersonas();
  
  if (!this.personas.find(p => p.name === this.activePersona)) {
    this.activePersona = 'ei';
  }
  
  const history = await loadHistory(this.activePersona);
  this.messages = history.messages;
  
  this.personaStates.clear();
  this.unreadCounts.clear();
  
  for (const persona of this.personas) {
    await this.loadPersistedPauseState(persona.name);
    const unreadCount = await getUnreadSystemMessageCount(persona.name);
    this.unreadCounts.set(persona.name, unreadCount);
  }
  
  this.render();
  this.autoScrollToBottom();
}
```

### Known Challenges
- **UI reload complexity**: In-memory caches must be fully invalidated/rebuilt
- **State size**: Large histories may consume significant memory (10 snapshots × multiple personas)
- **Race conditions**: Snapshot must complete before write begins
- **Partial failures**: If restore fails mid-operation, system may be in inconsistent state

### Future Enhancements (Out of Scope)
- Compression (ZIP or gzip) for disk saves
- Configurable snapshot limits (currently hardcoded to 10)
- Diff-based snapshots to reduce memory usage
- State file pruning based on age instead of count
- Per-persona undo (currently system-wide only)

## Related Tickets
- **Supersedes**: #0051 (Undo System - In-Memory State)
  - Original design assumed per-persona undo, but async concepts require system-wide restore
  - Unified design resolves architectural concerns about inconsistent human concept state
