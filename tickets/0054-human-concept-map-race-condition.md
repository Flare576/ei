# 0054: Human Concept Map Race Condition Protection

**Status**: PENDING

## Summary
Implement synchronization mechanism to prevent race conditions when multiple personas simultaneously update the shared human concept map file.

## Problem
The current system has a critical race condition in human concept map updates:

1. **Shared Resource**: All personas update the same `human.jsonc` file containing concepts about the user
2. **Concurrent Access**: Multiple personas can process messages simultaneously (background processing)
3. **No Synchronization**: Each persona independently loads, modifies, and saves the human concept map
4. **Data Loss**: Later saves overwrite earlier updates, losing learned concepts

**Example Race Condition:**
- Persona A loads `human.jsonc` (version 1: `{concepts: []}`)
- Persona B loads `human.jsonc` (version 1: `{concepts: []}`)
- Persona A learns "user likes coffee" → saves `human.jsonc` (version 2: `{concepts: ["coffee"]}`)
- Persona B learns "user works remotely" → saves `human.jsonc` (version 3: `{concepts: ["remote_work"]}`)
- **Result**: Coffee preference is permanently lost

This becomes more likely as:
- More personas are active simultaneously
- Heartbeat frequency increases
- User has more active conversations

## Proposed Solution
Implement a file-based locking mechanism with concept merging for human concept map updates:

### 1. Atomic Update Operations
```typescript
// New storage function with locking
export async function updateHumanConceptMap(
  updater: (currentMap: ConceptMap) => ConceptMap,
  maxRetries: number = 3
): Promise<void>
```

### 2. File-Based Locking
- Use `.lock` file alongside `human.jsonc` to coordinate access
- Implement exponential backoff retry mechanism
- Include process ID and timestamp in lock file for stale lock detection

### 3. Concept Merging Strategy
- Load current concepts before applying updates
- Merge new concepts with existing ones (no overwrites)
- Update concept levels using weighted averaging based on recency
- Preserve all concept data, prioritize most recent updates

### 4. Integration Points
- Update `processor.ts` to use new atomic update function
- Maintain existing API for system concept maps (no race condition - per-persona files)
- Add debug logging for lock contention and merge operations

## Acceptance Criteria
- [ ] Implement file-based locking mechanism for human concept map updates
- [ ] Create atomic update function that handles load-modify-save operations
- [ ] Implement concept merging logic that preserves all learned information
- [ ] Add exponential backoff retry mechanism for lock contention
- [ ] Include stale lock detection and cleanup (process ID + timestamp)
- [ ] Update processor.ts to use atomic updates for human concepts
- [ ] Maintain backward compatibility with existing concept map structure
- [ ] Add comprehensive logging for debugging race condition scenarios
- [ ] Write property-based tests for concurrent update scenarios
- [ ] Write unit tests for concept merging edge cases
- [ ] Verify no performance degradation for single-persona usage
- [ ] Test with multiple personas updating concepts simultaneously

## Value Statement
**Critical Data Integrity**: Prevents permanent loss of learned user preferences and context. Essential for multi-persona conversations where background processing creates natural race conditions. Without this fix, the system becomes less intelligent over time as concepts are randomly lost.

## Dependencies
- None - this is a foundational fix that other features depend on

## Effort Estimate
Medium (~3-4 hours)
- File locking implementation: 1 hour
- Concept merging logic: 1 hour  
- Integration and testing: 1-2 hours

## Technical Notes
- Consider using `flock` or similar for more robust locking on Unix systems
- Lock files should include process ID for cleanup of stale locks
- Concept merging should be additive - never remove existing concepts
- Performance impact should be minimal for single-persona usage
- Debug logging essential for diagnosing lock contention in production