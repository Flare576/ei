# 0095: Schema Changes - Group Fields

**Status**: PENDING

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
- [ ] `PersonaMetadata` interface includes `group_primary` (string | null)
- [ ] `PersonaMetadata` interface includes `groups_visible` (string[] | undefined)
- [ ] `HumanConcept` interface includes `persona_groups` (string[])
- [ ] Validation ensures `group_primary` is string or null
- [ ] Validation ensures `groups_visible` is array of strings when present
- [ ] Validation ensures `persona_groups` is array of strings
- [ ] Ei persona automatically gets `groups_visible: ["*"]` on load
- [ ] New personas default to `group_primary: null`, `groups_visible: []`
- [ ] New concepts default to `persona_groups: []`
- [ ] Schema validation tests pass for all three fields

## Dependencies
None

## Effort Estimate
Small (~1 hour)
