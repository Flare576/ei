# 0003: Storage Interface & LocalStorage

**Status**: DONE
**Depends on**: 0002

## Summary

Implement the Storage interface and LocalStorage implementation for browser-based persistence. This enables the StateManager to load/save state without knowing about the underlying storage mechanism.

## Acceptance Criteria

- [x] Create `src/storage/interface.ts` with `Storage` interface from CONTRACTS.md
- [x] Create `src/storage/local.ts` with `LocalStorage` implementation
- [x] LocalStorage uses browser's `localStorage` API
- [x] Implement all interface methods: `load()`, `save()`, `isAvailable()`, `listCheckpoints()`, `saveCheckpoint()`, `loadCheckpoint()`, `deleteCheckpoint()`
- [x] Handle localStorage size limits gracefully (error, not crash)
- [x] Export from `src/storage/index.ts`
- [ ] Unit tests for LocalStorage - **deferred to test infrastructure ticket**

## Implementation Notes

### StorageState Shape

```typescript
interface StorageState {
  version: number;
  human: HumanEntity;
  personas: Record<string, {
    entity: PersonaEntity;
    messages: Message[];
  }>;
  queue: LLMRequest[];
  settings: Record<string, unknown>;
}
```

### localStorage Keys

- `ei_state` - Main state
- `ei_checkpoint_{name}` - Named checkpoints
- `ei_checkpoints` - Index of checkpoint names/timestamps

### Size Limits

localStorage is typically 5-10MB. If save fails due to quota:
1. Log warning
2. Throw error with code `STORAGE_SAVE_FAILED`
3. Do NOT silently truncate data

## File Structure

```
src/
└── storage/
    ├── interface.ts   # Storage interface
    ├── local.ts       # LocalStorage implementation
    └── index.ts       # Re-exports
```
