# 0063: Add last_updated Timestamp to Concepts

**Status**: DONE

## Summary
Add a `last_updated` timestamp field to individual Concept objects to enable time-based decay calculations. This allows the heartbeat system to programmatically adjust concept levels based on how long since each concept was last updated.

## Problem
Currently, only the ConceptMap has a `last_updated` field (when the whole map was saved). For programmatic decay, we need per-concept timestamps to:
1. Calculate how much time has passed since each concept was touched
2. Apply elasticity-based decay proportional to time elapsed
3. Distinguish recently-reinforced concepts from stale ones

## Proposed Solution

### 1. Update Concept Interface (types.ts)
```typescript
export interface Concept {
  name: string;
  description: string;
  level_current: number;
  level_ideal: number;
  level_elasticity: number;
  type: ConceptType;
  learned_by?: string;
  last_updated?: string; // NEW - ISO timestamp, optional for backward compat
}
```

### 2. Update Concept Processing (processor.ts)
When concepts are updated by LLM:
```typescript
// After receiving new concepts from LLM
const now = new Date().toISOString();
for (const concept of newConcepts) {
  const existing = oldConcepts.find(c => c.name === concept.name);
  if (!existing || conceptChanged(existing, concept)) {
    concept.last_updated = now;
  } else {
    // Preserve existing timestamp if concept unchanged
    concept.last_updated = existing?.last_updated || now;
  }
}
```

### 3. Update Persona Creator (persona-creator.ts)
Set initial timestamps when creating new personas:
```typescript
const concepts: Concept[] = EI_STATIC_CONCEPTS.map(c => ({
  ...c,
  last_updated: new Date().toISOString()
}));
```

### 4. Migration Strategy
- Existing concepts without `last_updated` get current timestamp on first load/save
- Field is optional for backward compatibility
- Default storage concepts (storage.ts) should include `last_updated`

## Acceptance Criteria
- [x] Concept interface updated with optional `last_updated` field
- [x] New concepts created with current timestamp
- [ ] LLM-updated concepts get timestamp when changed (deferred to processor.ts ticket)
- [ ] Unchanged concepts preserve their existing timestamp (deferred to processor.ts ticket)
- [x] Default concepts in storage.ts include timestamps
- [x] Persona creator sets timestamps on new personas
- [x] Existing concept files load correctly (backward compatible)
- [ ] Unit tests for timestamp preservation logic (deferred to processor.ts ticket)
- [x] TypeScript compilation passes

## Value Statement
**Enables Programmatic Decay**: Per-concept timestamps are essential for the elasticity-based decay system. Without them, we can't calculate time-proportional adjustments.

## Dependencies
- Part of 0061: Concept Processing Architecture Overhaul
- Blocking 0067: Replace heartbeat LLM calls with programmatic decay

## Effort Estimate
Small (~1 hour)
- Type update: 10 minutes
- Processor updates: 20 minutes
- Storage/creator updates: 15 minutes
- Tests: 15 minutes

## Technical Notes
- ISO 8601 timestamps for consistency with existing timestamp fields
- Consider helper function `conceptChanged(old, new)` for comparing concepts
- Static concepts should also get timestamps (they can have level_current changes)
