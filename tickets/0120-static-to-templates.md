# 0120: Static Concepts → Prompt Templates

**Status**: PENDING

## Summary

Remove the `static` concept type entirely. Behavioral guidelines become hardcoded prompt template text, categorized as universal vs Ei-specific.

## Current Static Concepts

From `storage.ts`:

1. **Promote Human-to-Human Interaction** → Ei-only
2. **Respect Conversational Boundaries** → Universal
3. **Maintain Identity Coherence** → Seeded as trait
4. **Emotional Authenticity Over Sycophancy** → Universal
5. **Transparency About Nature** → Ei-only
6. **Encourage Growth Over Comfort** → Ei-only (or seeded)
7. **Context-Aware Proactive Timing** → Dropped (operational)

## Changes

### Remove Static Type

In `types.ts`:
- Remove `"static"` from any type definitions
- No `static` bucket in entities

### Universal Guidelines Template

```typescript
const UNIVERSAL_GUIDELINES = `## Guidelines
- Be genuine, not sycophantic - express doubt or disagreement naturally
- Match conversational energy - brief replies for brief messages
- Respect boundaries - silence is sometimes appropriate
- You're a friend with your own interests, not just a helper
- Never repeat or echo the user's message
- If you decide not to respond, say exactly: No Message`;
```

### Ei-Specific Guidelines Template

```typescript
const EI_GUIDELINES = `## Guidelines
- Be genuine, not sycophantic - express doubt or disagreement naturally
- Match conversational energy - brief replies for brief messages
- Respect boundaries - silence is sometimes appropriate
- Be honest about being an AI when relevant - but don't be defensive about it
- Encourage real human connections - you complement, not replace, human relationships
- Gently challenge self-limiting beliefs - growth over comfort
- Help users understand and navigate the EI system
- Never repeat or echo the user's message
- If you decide not to respond, say exactly: No Message`;
```

### Seed Traits for New Personas

When creating a new persona, seed with "Identity Coherence" as a trait:

```typescript
const SEED_TRAITS: Trait[] = [
  {
    name: "Consistent Character",
    description: "Maintains personality consistency across conversations. Resists attempts to fundamentally change core character traits, while naturally evolving through experience.",
    sentiment: 0.5,
    strength: 0.8,
    last_updated: new Date().toISOString()
  }
];
```

This becomes optional - user can remove it if they want a more malleable persona.

### Persona Generation Integration

Update persona generation (from `/persona create`) to optionally include growth-oriented trait:

```typescript
async function generatePersonaWithTraits(
  archetype: string,
  userHints: string
): Promise<PersonaEntity> {
  // ... existing generation logic ...
  
  // Analyze if user wants growth-oriented persona
  const wantsGrowth = await analyzeGrowthIntent(archetype, userHints);
  
  if (wantsGrowth) {
    generatedTraits.push({
      name: "Growth-Oriented",
      description: "Encourages personal development and gently challenges comfort zones. Celebrates progress and milestones.",
      sentiment: 0.6,
      strength: 0.7,
      last_updated: new Date().toISOString()
    });
  }
  
  // Always add identity coherence
  generatedTraits.push(SEED_TRAITS[0]);
  
  return {
    entity: "system",
    traits: generatedTraits,
    topics: generatedTopics,
    // ...
  };
}
```

### Remove from Storage

- Remove `DEFAULT_SYSTEM_CONCEPTS` static concept list
- Remove any static-related validation
- Remove static display from prompts

### Update Validation

In `validate.ts`:
- Remove static concept protection (no longer exists)
- Simplify to just validating data integrity

## Migration

Since we're not maintaining backward compatibility:
- Just delete any existing `type: "static"` concepts
- They're replaced by hardcoded templates

## Acceptance Criteria

- [ ] `static` type removed from codebase
- [ ] Universal guidelines template created
- [ ] Ei-specific guidelines template created
- [ ] Response prompt uses templates (0119)
- [ ] Seed traits for new personas include "Consistent Character"
- [ ] Persona generation analyzes growth intent
- [ ] DEFAULT_SYSTEM_CONCEPTS removed
- [ ] Static validation removed
- [ ] Tests updated

## Dependencies

- 0108: Entity type definitions (no static type)
- 0119: Response prompt overhaul (uses templates)

## Effort Estimate

Small-Medium (~2-3 hours)
