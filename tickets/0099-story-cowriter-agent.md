# 0099: Story Co-Writer Agent (Non-Persona)

**Status**: PENDING
**Depends on**: 0098 (could be one of the templates)
**Complexity**: HIGH - may require prompt architecture changes

## Summary

Create a special agent type that doesn't adopt a fixed persona but instead acts as a collaborative story co-writer. This agent takes ownership of some characters while providing feedback on all characters and narrative arcs. It's a "meta" role that sits outside the normal persona paradigm.

## Acceptance Criteria

- [ ] New agent type: "Co-Writer" distinct from regular personas
- [ ] Co-Writer can be assigned ownership of specific characters in a story
- [ ] Co-Writer writes dialogue/actions for owned characters
- [ ] Co-Writer provides feedback on user's characters and plot developments
- [ ] Co-Writer maintains story bible (characters, settings, plot threads)
- [ ] Co-Writer flags continuity issues or inconsistencies
- [ ] Works within existing message/conversation infrastructure

## Open Questions (Require Investigation)

1. **Prompt Architecture**: Current prompts assume a fixed persona identity. How do we prompt an agent that explicitly has NO fixed identity but shifts between characters?

2. **Character Ownership**: How does the user assign characters? UI? In-conversation commands?

3. **Story State**: Where does the "story bible" live? New entity type? Extension of existing data model?

4. **Turn Structure**: Does this change conversation flow? (e.g., agent might respond as multiple characters in one turn)

5. **Feedback Mode vs Writing Mode**: Should these be explicit modes, or does the LLM decide contextually?

## Research Needed

- How do existing AI writing tools (NovelAI, Sudowrite, etc.) handle collaborative writing?
- What prompt structures work for character-switching agents?
- Can we leverage existing persona traits/topics for character definitions?

## Notes

**Why This Is Tricky**:
- Current `PersonaEntity` assumes the AI IS the persona
- This agent needs to PLAY multiple characters without BEING any of them
- May need a new entity type or a `mode` field that changes prompt behavior
- `is_static` won't cut it - this is fundamentally different

**Potential Approaches**:
1. **Character Sub-Entities**: Co-Writer has child `Character` entities it controls
2. **Story Mode Flag**: A persona field that switches prompt templates entirely
3. **Separate Agent System**: Co-Writer uses different prompts/handlers altogether

**V0 Reference**: Nothing comparable exists in V0.

## Technical Speculation

```typescript
interface CoWriterEntity {
  entity: "cowriter";
  story_title: string;
  owned_characters: Character[];
  observed_characters: Character[]; // User's characters
  story_threads: PlotThread[];
  settings: Setting[];
  // ... story bible data
}

interface Character {
  name: string;
  description: string;
  traits: Trait[];
  relationships: { character: string; relationship: string }[];
  arc?: string;
}
```

This ticket needs significant design work before implementation.
