# 0095: Schema Changes - Group Fields

**Status**: DONE

## Summary
Add group fields to persona and human concept schemas.

## Parent Epic
0094: Group-Based Concept Visibility System

## Changes Required

### Persona schema (`src/types.ts`):
```typescript
interface PersonaMetadata {
  name: string;
  group_primary: string | null;      // NEW: Primary group for creating concepts
  groups_visible?: string[];         // NEW: Additional groups visible (primary implied)
  // ... existing fields
}
```

### Human concept schema (`src/types.ts`):
```typescript
interface HumanConcept {
  label: string;
  persona_groups: string[];          // NEW: Groups that can see this concept
  // ... existing fields
}
```

## Implementation Notes
- `groups_visible` defaults to `[]` (only see own group + global)
- Visibility from `group_primary` is **implied** (don't duplicate in `groups_visible`)
- Empty `persona_groups` means globally visible
- Ei special case: `group_primary: null`, `groups_visible: ["*"]`
- Groups are free-form strings (no predefined list)

## Acceptance Criteria
- [x] `PersonaMetadata` interface includes `group_primary` (string | null)
- [x] `PersonaMetadata` interface includes `groups_visible` (string[] | undefined)
- [x] `HumanConcept` interface includes `persona_groups` (string[])
- [x] Validation ensures `group_primary` is string or null
- [x] Validation ensures `groups_visible` is array of strings when present
- [x] Validation ensures `persona_groups` is array of strings
- [x] Ei persona automatically gets `groups_visible: ["*"]` on load
- [x] New personas default to `group_primary: null`, `groups_visible: []`
- [x] New concepts default to `persona_groups: []`
- [x] Schema validation tests pass for all three fields

## Dependencies
None

## Effort Estimate
Small (~1 hour)
