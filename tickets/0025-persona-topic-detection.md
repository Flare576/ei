# 0025: Persona Topic Detection

**Status**: PENDING
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

Detect topics that personas actively engage with during conversation. Unlike traits (explicit requests), topics emerge from engagement patterns — what does the persona show interest in? What do they ask follow-up questions about?

## Acceptance Criteria

- [ ] Create `src/prompts/persona/topics-detection.ts` with `buildPersonaTopicDetectionPrompt(data): { system: string; user: string }`
- [ ] Prompt includes persona's current topics
- [ ] Prompt includes recent conversation
- [ ] Prompt detects topics persona engaged with (not just mentioned)
- [ ] Prompt updates exposure_current for discussed topics
- [ ] Prompt may add new topics the persona showed interest in
- [ ] Implement `handlePersonaTopicDetection` handler
- [ ] Handler updates persona topics
- [ ] Unit tests

## Technical Notes

### Data Contract

```typescript
interface PersonaTopicDetectionPromptData {
  persona_name: string;
  current_topics: Topic[];
  messages_context: Message[];
  messages_analyze: Message[];
}

// Expected response
type PersonaTopicDetectionResult = Array<{
  name: string;
  description: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
}>;
```

### Engagement vs Mention

From V0 extraction.ts evidence requirements:
> "If the topic is only mentioned by the human about themselves → SKIP"
> "Persona actively discusses, offers expertise, or shows designed interest → PROCEED"

The persona must ENGAGE, not just respond when asked.

### exposure_current Updates

- Topic discussed with enthusiasm: +0.2 to +0.3
- Topic mentioned briefly: +0.1
- Topic not mentioned: no change (decay handles reduction)

### Handler Flow

```
handlePersonaTopicDetection(response, stateManager):
  1. Parse topic list from response.parsed
  2. Merge with existing topics (by name match)
  3. Update persona entity
  4. Fire onPersonaUpdated if changes
```

### V0 Reference

`v0/src/extraction.ts` — `runPersonaTopicExtraction`
`v0/src/prompts/persona/topics-detection.ts`

### When to Run

- After every conversation (like trait extraction)
- During Ceremony for comprehensive update

## Out of Scope

- Topic exploration/generation (0026)
- Human topic detection (E006)
- Decay (Ceremony handles this)
