# 0114: Fact Validation Web UI

**Status**: DONE
**Depends on**: 0113, 0082
**Completed**: 2026-02-01

## Summary

Add validation controls to the Human Facts Tab in the web frontend. Users can mark facts as "validated" (human confirmed), which locks them from automatic updates by the extraction pipeline.

## Acceptance Criteria

- [x] Replace Confidence slider with Validated checkbox in fact card
- [x] Checkbox label: "This is correct" or "Validated"
- [x] Checkbox state reflects `fact.validated === "human"`
- [x] Checking the box:
  - Sets `validated: "human"`
  - Sets `validated_date: now()`
  - Triggers save (or marks card dirty if using save button pattern)
- [x] Unchecking the box:
  - Sets `validated: "none"`
  - Sets `validated_date: now()`
- [x] Visual indicator for validation status:
  - Card background tint: light green for human-validated, light yellow for Ei-notified
  - Border accent on left side for visual clarity
- [x] Tooltip explaining what validation means: "Validated facts won't be changed automatically. Uncheck to allow updates."

## Notes

**Design reference**: The existing 0082 ticket specified "Confidence slider" in the split pane row. This ticket replaces that with a checkbox.

**UX consideration**: The checkbox should feel like a "lock" action. Once checked, the user is saying "I've reviewed this, it's correct, don't touch it."

**No batch validation**: For now, validation is per-fact. Batch "validate all" could be a future enhancement.
