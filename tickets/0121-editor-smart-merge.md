# 0121: HumanEditor Smart Merge

**Status**: DONE
**Depends on**: None
**Blocked by**: None

## Summary

HumanEditor currently resets ALL form fields whenever the `human` prop updates. This causes user input to vanish when backend events fire (e.g., during LLM extraction). Need "smart merge" that preserves dirty fields while allowing clean fields to live-update.

## Problem

1. User opens HumanEditor, starts typing in "Name Display" field
2. Backend fires `onHumanUpdated` (new fact extracted, etc.)
3. `useEffect` triggers, resets ALL local state from `human` prop
4. User's in-progress typing is lost

Current behavior is useful for live-updating lists (Facts, Traits, etc.) as extraction happens, so we can't just block all updates.

## Acceptance Criteria

- [x] Settings fields only reset if they're not dirty
- [x] Per-field dirty tracking for settings (not just boolean `settingsDirty`)
- [x] Dirty fields preserve user input through backend updates
- [x] Clean fields continue to live-update
- [x] After successful save, field becomes "clean" again
- [x] Same pattern applied to entity lists (Facts, Traits, Topics, People) if needed

## Technical Approach

Split the single `useEffect` into two:
1. **Modal open effect** - fires only on `isOpen` transition false→true, does full state reset
2. **Human update effect** - fires on `human` changes while open, does smart merge

Smart merge uses `smartMergeList()` helper that:
- Preserves dirty items (user edits)
- Updates non-dirty items from incoming data
- Adds new items from incoming data
- Keeps dirty items that were deleted upstream until user saves/discards

Also preserves secondary modal states (`accountEditorOpen`, `editingQuote`) during human updates.

## Notes

- May want similar treatment for PersonaEditor
- Consider debouncing updates to reduce churn
- Edge case: what if backend value changes to match user's dirty value? Could clear dirty flag.
