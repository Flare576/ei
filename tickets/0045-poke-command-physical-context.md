# 0045: Poke Command with Physical Context Interpretation

**Status**: PENDING

## Summary
Implement `/poke` command that prompts the persona to interpret the interaction in a physical context, encouraging more natural, contextual responses.

## Problem
Standard heartbeats and messages follow predictable patterns. Users need a way to prompt more spontaneous, contextually-aware responses that consider the physical/environmental context of the interaction.

## Proposed Solution
Implement `/poke [persona]` command with specialized prompting:

```typescript
// Poke command behavior
/poke           // Pokes active persona
/poke <name>    // Pokes specific persona
```

**Prompt strategy:**
- Tell the LLM this is a "poke" interaction
- Encourage interpretation in physical/environmental context
- If no relevant context exists, assume user wants engagement
- If no current topic, suggest starting a new one
- More spontaneous than regular heartbeat

**Example prompt addition:**
> "The user has 'poked' you - interpret this as a physical gesture or environmental cue. Consider your current context and respond naturally. If no specific context applies, assume they want your attention or a response."

## Acceptance Criteria
- [ ] `/poke` command triggers immediate response from active persona
- [ ] `/poke <name>` targets specific persona by name
- [ ] Poke prompt instructs LLM to consider physical/environmental context
- [ ] Response differs from standard heartbeat (more contextual/spontaneous)
- [ ] Works when persona has no current conversation topic
- [ ] Poke interactions are logged in chat history
- [ ] Command bypasses normal heartbeat timing
- [ ] `/help` command documents poke syntax and purpose
- [ ] Poke responses feel more natural and contextually aware than heartbeats

## Value Statement
Provides a more natural way to engage personas with contextual awareness, making interactions feel less scripted and more responsive to the user's immediate environment.

## Dependencies
- None (builds on existing LLM prompting system)

## Effort Estimate
Small (~1-2 hours)