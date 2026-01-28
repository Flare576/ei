# 0067: Cross-Persona Validation Queue

**Status**: DONE
**Depends on**: 0027

## Summary

When non-Ei personas learn General-group data, queue for Ei validation.

## Acceptance Criteria

- [x] `ei_validation` queue items created by Step 3 handler
- [x] Priority inversely proportional to confidence
- [x] Ei heartbeat handler checks for pending validations
- [x] Ei prompts user about unvalidated items naturally in conversation
- [x] Validated items marked as confirmed (update `last_confirmed`)
- [x] Uses `queue_getValidations()` and `queue_clearValidations()` from StateManager

## Notes

**V1 Backward Reference**:
- "If non-Ei persona and General group: add ei_validation queue item, inverse priority to confidence"

This ensures data learned by specialized personas gets sanity-checked by Ei, who has the broadest context.

## Implementation

- `src/core/handlers/index.ts` - `queueEiValidation()` function
- Validation queued when: non-Ei persona learns item in General group (or no group)
- Priority mapping:
  - High confidence (>0.7) -> Low priority (less urgent)
  - Medium confidence (0.4-0.7) -> Normal priority
  - Low confidence (<0.4) -> High priority (more urgent)
- Uses existing `handleEiValidation` handler for processing results
