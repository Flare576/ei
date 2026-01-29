# 0098: Pre-configured Persona Templates

**Status**: PENDING
**Depends on**: None (UI work, can start anytime)

## Summary

Add a "Templates" tab to the Persona Builder interface offering pre-configured personas that users can start from. Most users will want similar core personas (therapist, coach, friend, etc.) - we should make onboarding frictionless by providing ready-to-use starting points.

## Acceptance Criteria

- [ ] Persona Builder has a new "Templates" tab alongside manual creation
- [ ] Templates display as cards with name, description, and preview of traits/topics
- [ ] Selecting a template pre-fills the persona creation form
- [ ] User can customize before finalizing (template is a starting point, not locked)
- [ ] Initial set includes 5-10 researched templates (see Notes)
- [ ] Templates stored as JSON definitions (easy to add more later)

## Research Task (Part of Story)

Research existing conversation bots, AI companions, and persona archetypes to identify the most common/useful templates:

- **Therapy/Wellness**: Woebot, Wysa, Replika's therapeutic modes
- **Productivity**: coaching bots, accountability partners
- **Entertainment**: character.ai popular characters, roleplay bots
- **Creative**: writing assistants, brainstorming partners
- **Social**: friend archetypes, mentor figures

Document findings and propose initial template set before implementation.

## Notes

**Candidate Templates (initial brainstorm)**:
- Supportive Friend - empathetic listener, casual tone
- Life Coach - goal-oriented, motivational
- Therapist - CBT-informed, reflective questions
- Creative Muse - brainstorming, wild ideas
- Devil's Advocate - challenges assumptions
- Study Buddy - learning companion, quiz mode
- Mentor - career/life advice, wisdom
- Hype Person - unconditional support, celebration

**V1 Backward Reference**:
- Aligns with onboarding flow (0090)
- Could integrate with persona image generation (0092)

## Technical Notes

Templates could be:
```typescript
interface PersonaTemplate {
  id: string;
  name: string;
  description: string;
  category: "wellness" | "productivity" | "creative" | "social";
  default_traits: TraitResult[];
  default_topics: TopicResult[];
  suggested_model?: string;
}
```
