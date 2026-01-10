# 0025: Ctrl+C Handling - Incomplete Abort

**Status**: VALIDATED

## Problem

When pressing Ctrl+C during message processing, the abort is only partial:
1. LLM response generation is killed (correct)
2. Concept map generation still proceeds (incorrect)
3. Application exits after concept generation (incorrect)

Expected behavior: Ctrl+C should cleanly abort the entire operation and return to input prompt, not exit the app.

## Acceptance Criteria

- [x] Ctrl+C aborts LLM call
- [x] Ctrl+C also aborts concept map generation
- [x] Application remains running after abort
- [x] User can immediately type a new message
- [x] No partial state persisted from aborted operations

## Technical Notes

- AbortController signal may not be propagated to all async operations
- Check `processor.ts` for concept map generation flow
- Ensure signal is checked between each async step

## Priority

Medium - Affects user experience during long-running operations.
