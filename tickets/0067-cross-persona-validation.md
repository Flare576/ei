# 0067: Cross-Persona Validation Queue

**Status**: PENDING
**Depends on**: 0027

## Summary

When non-Ei personas learn General-group data, queue for Ei validation.

## Acceptance Criteria

- [ ] `ei_validation` queue items created by Step 3 handler
- [ ] Priority inversely proportional to confidence
- [ ] Ei heartbeat handler checks for pending validations
- [ ] Ei prompts user about unvalidated items naturally in conversation
- [ ] Validated items marked as confirmed (update `last_confirmed`)
- [ ] Uses `queue_getValidations()` and `queue_clearValidations()` from StateManager

## Notes

**V1 Backward Reference**:
- "If non-Ei persona and General group: add ei_validation queue item, inverse priority to confidence"

This ensures data learned by specialized personas gets sanity-checked by Ei, who has the broadest context.
