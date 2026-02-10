# 0132: Poke Functionality (Prompt Response)

**Status**: PENDING
**Depends on**: 0011

## Summary

Allow users to "poke" a persona when they expected a response but got "No Response". This sends a system prompt nudging the persona to respond, acknowledging the user's expectation.

## Context

Sometimes personas choose "No Response" when the user genuinely expected engagement. This feature gives users a way to say "hey, I was hoping you'd respond to that" without retyping or rephrasing their message.

## Acceptance Criteria

### Core Functionality
- [ ] User can trigger "poke" action on a persona
- [ ] Poke sends a system-level prompt indicating user expected a response
- [ ] Two modes:
  - **With message**: "I expect a response to this" (before sending)
  - **Without message**: "I expected a response to that" (after No Response)
- [ ] Persona processes the poke and generates a response

### UI/UX
- [ ] Poke action is accessible but not prominent (not frequently used)
- [ ] Clear feedback that poke was sent
- [ ] Consider: button on No Response indicator? Context menu? Keyboard shortcut?

### System Prompt
- [ ] Prompt should be gentle, not demanding
- [ ] Suggested approach: Frame as "the user is looking to you for input on this"
- [ ] Should not override persona's personality or force unnatural responses

## Notes

- This is exploratory—usage patterns unknown
- May want to track poke frequency to understand if it's a symptom of prompt tuning issues
- Consider whether pokes should be visible in chat history or silent
- Alternative names considered: "nudge", "prompt", "request response"
- Could tie into 0130 (No Response Explanation) - add poke button to the explanation UI?

## Open Questions

1. Where does the poke UI live? (Chat bubble? Persona panel? Keyboard shortcut?)
2. Should poke history be tracked/visible?
3. Rate limiting? (Prevent spam-poking)
