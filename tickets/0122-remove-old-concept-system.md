# 0122: Remove Old Concept System

**Status**: PENDING

## Summary

Clean up all remnants of the old `Concept` and `ConceptMap` system once the new entity architecture is in place.

## Files to Update

### src/types.ts
- [x] Remove `ConceptType` (done in 0108)
- [x] Remove `Concept` interface (done in 0108)
- [x] Remove `ConceptMap` interface (done in 0108)
- [ ] Remove `ConceptMapUpdate` interface
- [ ] Update any remaining references

### src/storage.ts
- [x] Remove `DEFAULT_SYSTEM_CONCEPTS` (done in 0109)
- [x] Remove `loadConceptMap` / `saveConceptMap` (done in 0109)
- [ ] Remove any concept-specific helper functions

### src/prompts.ts
- [x] Rebuild `buildResponseSystemPrompt` (done in 0119)
- [ ] Remove `buildConceptUpdateSystemPrompt`
- [ ] Remove `buildConceptUpdateUserPrompt`
- [ ] Remove `formatConceptsByType`
- [ ] Remove `getHighestNeedConcepts` (replaced by new logic)
- [ ] Remove `stripConceptMetaFieldsForLLM`
- [ ] Update `getVisibleConcepts` → new visibility logic

### src/processor.ts
- [ ] Remove `updateConceptsForMessages` (replaced by new extraction)
- [ ] Remove `conceptsChanged` helper
- [ ] Update `processEvent` to use new entity types

### src/validate.ts
- [x] Remove static concept validation (done in 0120)
- [ ] Update to validate new entity types
- [ ] Remove `mergeWithOriginalStatics`
- [ ] Simplify to data integrity checks

### src/concept-reconciliation.ts
- [ ] Likely delete entirely or repurpose
- [ ] Group reconciliation moves to new storage functions

### src/concept-decay.ts
- [ ] Update to work with new Topic/Person types
- [ ] Same decay logic, different data structure

### src/concept-queue.ts
- [x] Replace with LLM queue (done in 0110)
- [ ] Delete this file

### src/persona-creator.ts
- [ ] Update to generate new entity structure
- [ ] Update `generatePersonaDescriptions` for new schema
- [ ] Add seed trait generation

## Tests to Update

### tests/unit/
- [ ] concept-decay.test.ts → topic-decay.test.ts
- [ ] concept-reconciliation.test.ts → entity-reconciliation.test.ts
- [ ] concept-visibility.test.ts → entity-visibility.test.ts
- [ ] processor.test.ts → update for new flow
- [ ] prompts.test.ts → update for new prompt structure

### tests/integration/
- [ ] Any concept-related integration tests

## Search Patterns

To find remaining references:
```bash
# Find all concept references
grep -r "Concept" src/ --include="*.ts"
grep -r "ConceptMap" src/ --include="*.ts"
grep -r "ConceptType" src/ --include="*.ts"

# Find old function calls
grep -r "loadConceptMap" src/ --include="*.ts"
grep -r "saveConceptMap" src/ --include="*.ts"
grep -r "buildConceptUpdate" src/ --include="*.ts"
```

## Order of Operations

1. Ensure all new code is in place (0108-0121)
2. Update consumers one at a time, running tests after each
3. Delete old files/functions only after consumers updated
4. Final grep to catch stragglers

## Acceptance Criteria

- [ ] No references to `Concept` type remain (except in git history)
- [ ] No references to `ConceptMap` remain
- [ ] Old prompt builders removed
- [ ] Old storage functions removed
- [ ] concept-queue.ts deleted
- [ ] concept-reconciliation.ts deleted or repurposed
- [ ] All tests pass
- [ ] Build succeeds with no type errors

## Dependencies

- All other 0107 sub-tickets must be complete

## Effort Estimate

Medium (~3-4 hours)

## Notes

This is a cleanup ticket - do it last. The goal is a clean codebase with no vestigial concept code.
