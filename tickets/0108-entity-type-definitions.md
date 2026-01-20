# 0108: New Entity Type Definitions

**Status**: PENDING

## Summary

Define the new TypeScript interfaces for the restructured entity data model. This is the foundation for all other work in the 0107 epic.

## Changes

### New Types (src/types.ts)

```typescript
// Base fields shared by all data items
interface DataItemBase {
  name: string;
  description: string;
  sentiment: number;           // -1.0 to 1.0
  last_updated: string;        // ISO timestamp
  learned_by?: string;         // which persona discovered this (human data only)
  persona_groups?: string[];   // visibility control (human data only)
  change_log?: ChangeEntry[];  // for Ei validation
}

interface ChangeEntry {
  date: string;                // ISO timestamp
  persona: string;             // who made the change
  delta_size: number;          // rough magnitude (string length diff)
  previous_value?: string;     // JSON stringified previous state (for Ei review)
}

// Biographical data - needs confirmation flow
interface Fact extends DataItemBase {
  confidence: number;          // 0.0-1.0, affects re-verification frequency
  last_confirmed?: string;     // ISO timestamp of last user confirmation
}

// Personality/behavioral patterns
interface Trait extends DataItemBase {
  strength?: number;           // 0.0-1.0, optional intensity
}

// Discussable subjects with engagement dynamics
interface Topic extends DataItemBase {
  level_current: number;       // 0.0-1.0, exposure/recency
  level_ideal: number;         // 0.0-1.0, discussion desire
}

// Relationships (human entity only)
interface Person extends DataItemBase {
  relationship: string;        // "daughter", "boss", "friend", etc.
  level_current: number;       // 0.0-1.0, relationship engagement recency
  level_ideal: number;         // 0.0-1.0, desire to discuss this person
}

// Human entity structure
interface HumanEntity {
  entity: "human";
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
  last_updated: string | null;
}

// Persona entity structure
interface PersonaEntity {
  entity: "system";
  
  // Identity
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  
  // Visibility
  group_primary?: string | null;
  groups_visible?: string[];
  
  // Data
  traits: Trait[];
  topics: Topic[];
  
  // State
  isPaused?: boolean;
  pauseUntil?: string;
  isArchived?: boolean;
  archivedDate?: string;
  
  last_updated: string | null;
}

// Union type for storage functions
type Entity = HumanEntity | PersonaEntity;
```

### Removed Types

- `ConceptType` - no longer needed
- `Concept` - replaced by Fact/Trait/Topic/Person
- `ConceptMap` - replaced by HumanEntity/PersonaEntity

### Type Guards

```typescript
function isHumanEntity(entity: Entity): entity is HumanEntity {
  return entity.entity === "human";
}

function isPersonaEntity(entity: Entity): entity is PersonaEntity {
  return entity.entity === "system";
}
```

## Acceptance Criteria

- [ ] All new interfaces defined in src/types.ts
- [ ] Old Concept-related types removed
- [ ] Type guards implemented
- [ ] JSDoc comments on all public interfaces
- [ ] No TypeScript errors (other files will break - that's expected)

## Dependencies

- None (this is the foundation)

## Notes

This ticket will intentionally break the build. Other tickets in the epic will fix the consuming code.

## Effort Estimate

Small (~1 hour)
