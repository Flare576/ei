# 0130: No Response Explanation UI

**Status**: PENDING
**Depends on**: 0044

## Summary

When a persona chooses "No Response" for the first time with a user, explain what happened via a grayed-out informational message in the chat history. This prevents confusion (e.g., thinking the system is broken) when users first encounter this behavior.

## Context

User's daughter didn't realize "No Response" was a valid persona choice and thought the system was broken when it happened.

## Acceptance Criteria

- [ ] Track whether user has seen a "No Response" from each persona
- [ ] On first "No Response", display an explanatory message in chat
- [ ] Message is visually distinct (grayed out, different styling than normal messages)
- [ ] Suggested text: "The Persona chose not to respond! This can happen when the Persona doesn't know what to say, doesn't have anything constructive to add, or doesn't have any questions for you."
- [ ] Subsequent "No Response" events from same persona do not show explanation
- [ ] Explanation persists across sessions (stored, not ephemeral)

## Notes

- Consider whether this should be stored per-persona or globally (first time ever vs first time per persona)
- The explanatory message should not be treated as a real message in the conversation history (no extraction, no context window impact)
- May want to add a dismissible tooltip or link to "learn more" in future iterations
