# 0046: Input Box: Pending Message Recall

**Status**: DONE
**Depends on**: 0045

## Summary

Allow user to recall pending messages back into the input box for editing.

## Acceptance Criteria

- [x] Up arrow at top of input box recalls pending messages
- [x] Clicking a pending message recalls it
- [x] Recall: aborts current LLM processing (if any)
- [x] Recall: removes pending messages from history
- [x] Recall: populates input box with recalled content
- [x] Multiple pending messages joined with newlines
- [x] Visual feedback during recall operation

## Notes

**V1 Backward Reference**:
- "Pressing [up] arrow at top of text box while message(s) are pending does 3 things:
  - Interrupts the agent (aborts processing)
  - Pulls all 'Pending' messages back into Input box
  - Removes 'Pending' messages from Persona's history"
- "Clicking a Pending message does the same thing"

## Implementation

- Added `messages_remove()` method to PersonaState, StateManager
- Added `recallPendingMessages()` method to Processor
- ChatPanel tracks `hasPendingMessages` state
- Up arrow key handler at cursor position 0 triggers recall
- Click on pending human messages triggers recall
- Visual "Recall" button appears when pending messages exist
- Pending messages show "(pending)" status in timestamp
- Placeholder text changes to indicate up arrow availability
