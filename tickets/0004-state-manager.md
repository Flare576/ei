# 0004: StateManager Implementation

**Status**: DONE
**Depends on**: 0002, 0003

## Summary

Implement the StateManager as the in-memory state holder with CRUD operations. This is the central data store that the Processor interacts with—it handles entities, messages, queue, and checkpoints.

## Acceptance Criteria

- [x] Create `src/core/state-manager.ts` implementing the StateManager interface from CONTRACTS.md
- [x] Implement all Human Entity methods (`getHuman`, `setHuman`, `human_*_upsert`, `human_*_remove`)
- [x] Implement all Persona methods (`persona_*`)
- [x] Implement all Message methods (`messages_*`)
- [x] Implement all Queue methods (`queue_*`) including pause/resume
- [x] Implement all Checkpoint methods (`checkpoint_*`)
- [x] Implement Settings methods (`settings_*`)
- [x] `initialize()` loads from Storage, creates defaults if empty
- [x] `persist()` saves to Storage
- [ ] Unit tests for all CRUD operations - **deferred to test infrastructure**
- [ ] Unit tests for checkpoint create/restore/persist flow - **deferred to test infrastructure**

## Implementation Notes

### Initialization

```typescript
async initialize(storage: Storage): Promise<void> {
  const state = await storage.load();
  if (state) {
    this.human = state.human;
    this.personas = state.personas;
    // etc.
  } else {
    // Create default empty state
    this.human = createDefaultHumanEntity();
    this.personas = {};
    // etc.
  }
}
```

### Queue Pause Behavior

When `queue_isPaused()` is true, `queue_peekHighest()` returns null even if items exist. This allows `abortCurrentOperation()` to stop processing without items being immediately re-picked.

### Checkpoint Limits

- Ephemeral checkpoints: 10 (FIFO rolloff)
- Persisted checkpoints: 5 (error if exceeded)

### ID Generation

Use `crypto.randomUUID()` for all ID generation (messages, data items, queue items).

## File Structure

```
src/
└── core/
    ├── types.ts
    ├── state-manager.ts  # NEW
    └── index.ts
```
