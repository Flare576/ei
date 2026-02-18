# 0146: Write-Through Storage Simplification

**Status**: DONE
**Depends on**: None (can be done independently, but consider sequencing with 0129)
**Blocked by**: None

## Summary

Replace the current checkpoint carousel (10 rotating auto-saves every 60s) with immediate write-through persistence. State saves on every mutation instead of periodically, eliminating data loss windows and simplifying the storage model.

## Background: Current System

### Auto-Save Carousel (Problem)
```
LocalStorage:
├── ei_autosaves: [state0, state1, ...state9]  # 10 rotating snapshots
├── ei_manual_10: {name, state}                # Named save slot
├── ei_manual_11: {name, state}                # Named save slot
└── ...
```

- **Processor** calls `shouldAutoSave()` every 100ms loop tick
- Triggers save when 60s elapsed: `Date.now() - lastAutoSave >= autoSaveInterval`
- Pushes new state to array, shifts oldest off (carousel)
- **Problem**: Up to 60s of data loss on crash/refresh
- **Problem**: 10 copies of full state = localStorage quota pressure

### State Mutation Flow (Current)
```typescript
// StateManager mutation methods
updateHuman(updater) {
  this.state.human = updater(this.state.human)
  // NO save here - waits for 60s timer
}

addMessage(personaName, message) {
  this.state.messages[personaName].push(message)
  // NO save here - waits for 60s timer
}

// Processor main loop (every 100ms)
if (this.shouldAutoSave()) {
  this.lastAutoSave = Date.now()
  await this.stateManager.checkpoint_saveAuto()  // Finally persists
}
```

## Solution: Write-Through Persistence

### New Model
```
LocalStorage:
├── ei_state: {human, personas, messages, ...}  # Single current state
└── (manual saves removed - use JSON export/import)
```

- Every mutation immediately writes to `ei_state`
- No carousel, no 60s timer, no data loss window
- Manual saves removed (export/import via JSON files is sufficient)
- Reduce storage footprint by ~90% (1 state vs 10)

## Acceptance Criteria

### Phase 1: Write-Through Core
- [x] Modify `StateManager` to save after every mutation
- [x] Add debounce (100ms) to batch rapid mutations (e.g., message + extraction)
- [x] Remove `checkpoint_saveAuto()` carousel logic
- [x] Remove `shouldAutoSave()` timer in Processor
- [x] Remove `lastAutoSave` / `autoSaveInterval` tracking

### Phase 2: Storage Interface Changes
- [x] `Storage.save(state)` - immediate write (replaces `saveAutoCheckpoint`)
- [x] `Storage.load()` - read current state (replaces carousel lookup)
- [x] Remove entire checkpoint system (manual checkpoints removed - export/import via JSON is sufficient)

### Phase 3: LocalStorage Implementation
- [x] Replace `ei_autosaves` array with single `ei_state` key
- [x] Migration: on load, if `ei_autosaves` exists, use latest and delete array

### Phase 4: FileStorage Implementation (TUI)
- [x] Same pattern: single `state.json` instead of checkpoint files
- [x] Migration: if old checkpoint files exist, use latest and clean up

### Phase 5: UI Updates
- [x] Remove SavePanel component (checkpoint management UI)
- [x] Update HelpModal to reference "Auto-save" instead of "Checkpoints"

### Phase 6: Cleanup & Tests
- [x] Remove carousel constants (`MAX_AUTO_SAVES`, etc.)
- [x] Update tests for new save behavior
- [x] Remove checkpoint-related tests
- [x] Update E2E tests for new storage format

## Technical Details

### Debounced Write Implementation
```typescript
// StateManager additions
private saveTimeout: ReturnType<typeof setTimeout> | null = null
private DEBOUNCE_MS = 100

private scheduleSave(): void {
  if (this.saveTimeout) clearTimeout(this.saveTimeout)
  this.saveTimeout = setTimeout(async () => {
    await this.storage.save(this.getStorageState())
    this.saveTimeout = null
  }, this.DEBOUNCE_MS)
}

// Every mutation method calls this at the end:
updateHuman(updater: (h: HumanEntity) => HumanEntity): void {
  this.state.human = updater(this.state.human)
  this.scheduleSave()  // <-- NEW
}
```

### Storage Interface Changes
```typescript
// storage/interface.ts
export interface Storage {
  isAvailable(): Promise<boolean>
  
  // NEW: Write-through
  save(state: StorageState): Promise<void>
  load(): Promise<StorageState | null>
  
  // KEEP: Manual checkpoints for explicit saves
  listCheckpoints(): Promise<Checkpoint[]>  // Returns manual only
  loadCheckpoint(index: number): Promise<StorageState | null>
  saveManualCheckpoint(index: number, name: string, state: StorageState): Promise<void>
  deleteManualCheckpoint(index: number): Promise<boolean>
  
  // REMOVE: Auto checkpoint carousel
  // saveAutoCheckpoint(state: StorageState): Promise<void>  // DELETE
}
```

### Processor Changes
```typescript
// processor.ts - REMOVE these
private lastAutoSave = 0                    // DELETE
private autoSaveInterval = 60000            // DELETE

private shouldAutoSave(): boolean {         // DELETE entire method
  return Date.now() - this.lastAutoSave >= this.autoSaveInterval
}

// In runLoop() - REMOVE auto-save block:
// if (this.shouldAutoSave()) { ... }       // DELETE
```

### Migration Logic (LocalStorage)
```typescript
async load(): Promise<StorageState | null> {
  // Try new format first
  const current = localStorage.getItem('ei_state')
  if (current) return JSON.parse(current)
  
  // Migrate from carousel
  const carousel = localStorage.getItem('ei_autosaves')
  if (carousel) {
    const saves = JSON.parse(carousel) as StorageState[]
    if (saves.length > 0) {
      const latest = saves[saves.length - 1]
      // Migrate to new format
      localStorage.setItem('ei_state', JSON.stringify(latest))
      localStorage.removeItem('ei_autosaves')
      return latest
    }
  }
  
  return null
}
```

## Sequencing Notes

### Relation to 0129 (Settings Menu Redesign)
- 0129 mentions Save/Load modal - this ticket changes what's shown there
- If 0129 done first: This ticket just updates the modal's data source
- If this done first: UI still works, just shows fewer checkpoints

### Recommendation
Do this ticket BEFORE or IN PARALLEL with 0129. The storage simplification makes the UI work easier (fewer states to display/manage).

## Testing

- [ ] Unit: StateManager saves after mutation
- [ ] Unit: Debounce batches rapid mutations
- [ ] Unit: Migration from carousel to single state
- [ ] Integration: Load → mutate → refresh → state persisted
- [ ] Manual: Verify localStorage size reduction (~90%)

## Notes

The current carousel was designed for recovery from bad states (roll back to earlier auto-save). In practice:
1. Users rarely need this - explicit manual saves are more reliable
2. The 60s window causes more data loss than carousel prevents
3. 10x storage overhead is significant for localStorage quota

Write-through with manual checkpoints gives:
- Zero data loss window
- Explicit recovery points when wanted
- 90% less storage usage
- Simpler code (no timer, no carousel management)
