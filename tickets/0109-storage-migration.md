# 0109: Storage Migration

**Status**: PENDING

## Summary

Update storage.ts to work with the new entity schema. Since we don't need backward compatibility, this is a clean replacement.

## Changes

### File Structure (unchanged paths)

- `data/human.jsonc` → HumanEntity
- `data/personas/{name}/system.jsonc` → PersonaEntity
- `data/personas/{name}/history.jsonc` → ConversationHistory (unchanged)

### Default Human Entity

```typescript
const DEFAULT_HUMAN_ENTITY: HumanEntity = {
  entity: "human",
  facts: [],
  traits: [],
  topics: [],
  people: [],
  last_updated: null
};
```

### Default Ei Persona

```typescript
const DEFAULT_EI_PERSONA: PersonaEntity = {
  entity: "system",
  aliases: ["default", "core"],
  group_primary: null,
  groups_visible: ["*"],
  traits: [
    {
      name: "Warm but Direct",
      description: "Friendly and approachable while being honest and straightforward. Doesn't sugarcoat but delivers truth with care.",
      sentiment: 0.3,
      strength: 0.7,
      last_updated: new Date().toISOString()
    }
  ],
  topics: [],  // Ei's topic list stays sparse - plenty to manage without a backlog
  last_updated: null
};
```

**Design Decisions (from Flare):**
- "System Guide" is NOT a trait - it's part of Ei's hardcoded prompt (see 0121)
- "Warm but Direct" IS a trait - users might want a firmer Ei, so this can be adjusted
- Topics start empty - Ei has plenty to manage without defaulting to conversation topics

## Acceptance Criteria

- [ ] DEFAULT_HUMAN_ENTITY defined with empty buckets
- [ ] DEFAULT_EI_PERSONA defined with appropriate initial traits
- [ ] loadHumanEntity / saveHumanEntity implemented
- [ ] loadPersonaEntity / savePersonaEntity implemented
- [ ] initializeDataDirectory creates new schema files
- [ ] Old concept-related storage functions removed
- [ ] All storage tests updated

## Dependencies

- 0108: Entity type definitions

## Effort Estimate

Medium (~2-3 hours)
