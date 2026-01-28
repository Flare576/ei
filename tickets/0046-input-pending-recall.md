# 0046: Input Box: Pending Message Recall

**Status**: PENDING
**Depends on**: 0045

## Summary

Allow user to recall pending messages back into the input box for editing.

## Acceptance Criteria

- [ ] Up arrow at top of input box recalls pending messages
- [ ] Clicking a pending message recalls it
- [ ] Recall: aborts current LLM processing (if any)
- [ ] Recall: removes pending messages from history
- [ ] Recall: populates input box with recalled content
- [ ] Multiple pending messages joined with newlines
- [ ] Visual feedback during recall operation

## Notes

**V1 Backward Reference**:
- "Pressing [up] arrow at top of text box while message(s) are pending does 3 things:
  - Interrupts the agent (aborts processing)
  - Pulls all 'Pending' messages back into Input box
  - Removes 'Pending' messages from Persona's history"
- "Clicking a Pending message does the same thing"
