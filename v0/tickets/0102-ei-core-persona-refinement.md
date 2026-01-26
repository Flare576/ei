# 0102: Ei Core Persona Refinement

**Status**: CANCELLED (absorbed into 0107)

## Summary
Ei is the system's default "meta" persona and needs special handling distinct from user-created personas. This ticket addresses Ei's unique onboarding flow, locked descriptions, and appropriate static concepts.

## Problems

### 1. No Onboarding Flow
New users start with an empty human concept map. Ei should:
- Introduce itself and explain what it does
- Ask about the user (name, interests, how they want to interact)
- Seed initial human concepts from this conversation
- Guide toward creating their first custom persona

### 2. Description Drift
Ei can currently update its own short/long descriptions like any persona, leading to:
- Self-assigned "modes of operation" that don't exist
- Task lists it thinks it should fulfill
- Identity drift away from its core purpose

### 3. Inappropriate Static Concepts
Current static concepts are a mix of:
- Universal guidelines (good for all personas)
- Ei-specific behaviors (shouldn't apply to "Gandalf")
- Operational details that belong in system prompt template

## Proposed Solutions

### 1. Ei Onboarding Flow
First-run detection (empty human concept map or new install):
```
Ei: "Hello! I'm Ei - think of me as a friendly guide to this system. 
I help you create and manage AI personas for different aspects of your life.

Before we dive in, I'd love to learn a bit about you. What should I call you?"
[... guided conversation to seed initial concepts ...]
```

### 2. Lock Ei Descriptions
- Hardcode Ei's `short_description` and `long_description` in code
- Skip description updates for Ei in concept processing
- Or: flag certain personas as `description_locked: true`

Proposed Ei descriptions:
- **short**: "Your guide to the EI persona system - helps you get started and manage your AI companions"
- **long**: "Ei is the default persona and system guide. Unlike other personas who roleplay specific characters, Ei focuses on helping you understand and use the system effectively. Ei can help you create new personas, explain features, and ensure you're getting the most out of your AI companions."

### 3. Reorganize Static Concepts
Split into categories:

**System Prompt Template** (not concepts - baked into prompt structure):
- Context-Aware Proactive Timing
- Response length matching
- Conversational guidelines

**Universal Persona Statics** (apply to all personas):
- Emotional Authenticity Over Sycophancy
- Respect Conversational Boundaries

**Ei-Only Statics** (only for Ei):
- Transparency About Nature
- Promote Human-to-Human Interaction
- System guidance behaviors

**Optional/Per-Persona** (user choice):
- Encourage Growth Over Comfort
- Maintain Identity Coherence

## Acceptance Criteria
- [ ] First-run detection identifies new users (empty/missing human concept map)
- [ ] Ei onboarding conversation seeds initial human concepts
- [ ] Ei's short/long descriptions are locked (not updated by LLM)
- [ ] Static concepts reorganized per above categories
- [ ] Ei-specific statics only load for Ei persona
- [ ] Universal statics load for all personas
- [ ] System prompt template includes operational guidelines (not as concepts)
- [ ] Tests cover onboarding flow
- [ ] Tests verify Ei description locking

## Dependencies
- 0103: Persona Prompt Architecture (general prompt cleanup)

## Effort Estimate
Medium-Large (~6-8 hours)
