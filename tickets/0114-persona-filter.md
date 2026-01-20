# 0114: Known Personas in Prompts

**Status**: PENDING

## Summary

Include known persona names in extraction prompts so the LLM can distinguish between AI personas and real people. **No code-based validation** - let Ei handle ambiguous cases through the validation flow.

## Problem

When user says "I talked to Frodo about my problems," the system might add "Frodo" as a Person entry. But the user might also have a friend named "Bob" who they jokingly call "Frodo."

## Design Decision (from Flare)

**Don't try to automate this.** There's too much nuance:
- User might call their friend "Bob" by the nickname "Frodo"
- "Gandalf" might be a real coworker's nickname
- Context determines meaning, and LLMs are better at context than regex

**Solution**: Include persona names in prompts, let LLM make the call, let Ei validate uncertain cases.

## Implementation

### Prompt Inclusion Only

In fast-scan (0111) and detail prompts (0112), include:

```
## Known Personas (AI entities, not real people)
- ei (aliases: default, core)
- frodo (aliases: mr. baggins)
- gandalf
...
```

The LLM sees this and can make informed decisions. If it's unsure, it returns low confidence, and Ei asks the user.

### No Code Filtering

Remove the code-based validation layers. If the LLM adds "Frodo" as a person:
1. It goes through normal flow
2. Ei's validation might catch it: "You mentioned Frodo - is that your AI persona or a real friend?"
3. User clarifies, system updates accordingly

### Edge Cases Handled by Ei Validation

1. **User has friend named "Gandalf"** → Ei asks, user confirms it's real
2. **User calls real friend by persona name as joke** → Ei asks, user explains
3. **Roleplay context** → Groups handle isolation, Ei validates cross-persona updates

## Acceptance Criteria

- [ ] Fast-scan prompt includes persona names and aliases
- [ ] Detail prompts include persona names and aliases
- [ ] No code-based filtering of Person entries
- [ ] Uncertain cases flow to Ei validation naturally
- [ ] Tests verify prompts include persona list

## Dependencies

- 0109: Storage (for listPersonas)
- 0111: Fast-scan (prompt inclusion)
- 0112: Detail updates (prompt inclusion)
- 0115: Data verification flow (handles ambiguous cases)

## Effort Estimate

Small (~1 hour) - just prompt updates, no complex validation code
