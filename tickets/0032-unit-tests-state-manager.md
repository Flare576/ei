# 0032: Unit Tests: StateManager

**Status**: DONE
**Depends on**: 0030
**Epic**: E004 - Testing Infrastructure

## Summary

Comprehensive unit tests for StateManager. This is the core state container — testing it thoroughly ensures data operations work correctly before we build on top.

## Acceptance Criteria

- [ ] Test human entity CRUD operations
- [ ] Test persona CRUD operations
- [ ] Test message operations
- [ ] Test queue operations (enqueue, peek, complete, fail)
- [ ] Test checkpoint operations
- [ ] Test context window operations
- [ ] Test settings operations
- [ ] Test initialization from storage
- [ ] Test state serialization/deserialization
- [ ] Coverage > 80% for StateManager and state modules

## Technical Notes

### Test Structure

```
tests/unit/core/
├── state-manager.test.ts      # Integration tests for StateManager facade
├── state/
│   ├── human.test.ts          # HumanState unit tests
│   ├── personas.test.ts       # PersonaState unit tests
│   ├── queue.test.ts          # QueueState unit tests
│   └── checkpoints.test.ts    # CheckpointState unit tests
```

### Mock Storage

Create a mock storage for testing:
```typescript
class MockStorage implements Storage {
  private data: Map<number, StorageState> = new Map();
  
  async isAvailable(): Promise<boolean> { return true; }
  async listCheckpoints(): Promise<Checkpoint[]> { /* ... */ }
  async loadCheckpoint(index: number): Promise<StorageState | null> {
    return this.data.get(index) ?? null;
  }
  // ... etc
}
```

### Key Test Cases

**Human Entity:**
- Add/update/remove facts, traits, topics, people
- Upsert by ID (update existing, add new)
- Last_updated timestamps update correctly

**Personas:**
- Add persona
- Update persona fields
- Archive/unarchive
- Delete
- Get by name (case sensitivity?)
- Messages per persona

**Queue:**
- Enqueue respects priority
- Peek returns highest priority
- Complete removes from queue
- Fail increments attempts
- Pause/resume affects peek
- Validations filtering

**Checkpoints:**
- Auto-save to slots 0-9 (FIFO)
- Manual save to slots 10-14
- Load by index
- Delete manual only
- List returns all

### V0 Reference

`v0/tests/unit/storage.test.ts` — patterns for storage testing

## Out of Scope

- Integration with real Storage (that's what E2E is for)
- Performance testing
- Concurrent access testing
