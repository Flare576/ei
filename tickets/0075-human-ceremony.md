# 0075: Human Ceremony (Decay + Ei Prompt)

**Status**: DONE
**Depends on**: 0072

## Summary

After all persona ceremonies complete, apply decay to Human entity and prompt Ei.

## Acceptance Criteria

- [x] Runs after all persona ceremonies complete (Ei is last persona)
- [x] Apply decay to Human's topics and people
- [x] Calculate delta: topics/people approaching "expire" threshold
- [x] Pass delta to Ei's next heartbeat context
- [x] Ei naturally asks about decaying topics before they expire
- [x] No direct LLM call - just data preparation for Ei

## Notes

**V1 Backward Reference**:
- "After all Personas have had their turn, apply Decay to Human's Topics and People"
- "This produces the delta that Ei uses to prompt the user"
- "Ei should ask about topics before they 'Expire'"
- "Ei cares about exactly what the human cares about"

Ei becomes the guardian of the human's interests, checking in about fading topics.
