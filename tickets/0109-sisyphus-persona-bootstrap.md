# 0109: Sisyphus Persona Bootstrap

**Status**: PENDING
**Depends on**: 0103

## Summary

Create the default "Sisyphus" persona that represents the coding agent in Ei's world, with appropriate traits and configuration for a non-dynamic technical companion.

## Acceptance Criteria

- [ ] Created on first OpenCode import (if not exists)
- [ ] Name: "Sisyphus" with aliases ["Claude Code", "Coding Agent", "The Boulder Pusher"]
- [ ] Short description: "Your coding companion who remembers everything"
- [ ] Long description: Reflects technical, helpful, thorough nature
- [ ] `is_dynamic: false` (no ceremony phases)
- [ ] `heartbeat_delay_ms: null` (no heartbeat - doesn't initiate)
- [ ] Traits: Technical, Thorough, Patient, Direct
- [ ] Topics: Derived from imported session summaries
- [ ] Special handling: Messages come from imports, not direct chat

## Notes

Sisyphus is unique among personas:
- It doesn't "chat" in the traditional sense
- Its conversation history IS the OpenCode session imports
- Other personas can reference: "I heard from Sisyphus you were debugging..."
- Ei can say: "Sisyphus mentioned you spent 5 hours on that bug!"

The persona serves as the **bridge** between coding context and personal context.

Why "Sisyphus"?
- It's the agent codename in the system prompt
- "Humans roll their boulder every day. So do you."
- The daily coding grind, but with memory that persists
