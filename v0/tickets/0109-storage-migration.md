# 0109: Storage Migration

**Status**: QA

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

- [x] DEFAULT_HUMAN_ENTITY defined with empty buckets
- [x] DEFAULT_EI_PERSONA defined with appropriate initial traits ("Warm but Direct")
- [x] loadHumanEntity / saveHumanEntity implemented
- [x] loadPersonaEntity / savePersonaEntity implemented
- [x] initializeDataDirectory creates new schema files
- [x] Old concept-related storage functions removed (loadConceptMap, saveConceptMap)
- [x] All persona-related functions updated to use PersonaEntity
- [x] All alias management functions updated to use PersonaEntity
- [x] All pause/archive state functions updated to use PersonaEntity
- [x] PersonaWithConceptMap renamed to PersonaWithEntity
- [x] loadAllPersonasWithConceptMaps renamed to loadAllPersonasWithEntities
- [x] storage.ts has no lsp_diagnostics errors
- [ ] All storage tests updated (deferred - no tests exist yet for storage layer)

## Dependencies

- 0108: Entity type definitions

## Effort Estimate

Medium (~2-3 hours)

## Implementation Notes

### What Was Completed

**New Entity Defaults:**
- Created `DEFAULT_HUMAN_ENTITY` with empty facts/traits/topics/people buckets
- Created `DEFAULT_EI_PERSONA` with "Warm but Direct" trait (sentiment: 0.3, strength: 0.7)
- Removed all 7 static concepts from DEFAULT_SYSTEM_CONCEPTS

**New Storage Functions:**
- `loadHumanEntity()` - loads data/human.jsonc as HumanEntity
- `saveHumanEntity(entity)` - saves HumanEntity with auto-updated timestamp
- `loadPersonaEntity(persona?)` - loads persona system.jsonc as PersonaEntity
  - Maintains backward compatibility for ei persona (ensures groups_visible: ["*"])
- `savePersonaEntity(entity, persona?)` - saves PersonaEntity with auto-updated timestamp

**Updated Existing Functions:**
- `initializeDataDirectory()` - now writes HumanEntity and PersonaEntity files
- `listPersonas()` - reads PersonaEntity instead of ConceptMap
- `getArchivedPersonas()` - reads PersonaEntity instead of ConceptMap
- `addPersonaAlias()` - loads/saves PersonaEntity
- `removePersonaAlias()` - loads/saves PersonaEntity
- `saveNewPersona()` - signature changed from ConceptMap to PersonaEntity
- `loadPauseState()` / `savePauseState()` - use PersonaEntity
- `loadArchiveState()` / `saveArchiveState()` - use PersonaEntity

**Renamed Functions:**
- `PersonaWithConceptMap` → `PersonaWithEntity` (interface)
- `loadAllPersonasWithConceptMaps()` → `loadAllPersonasWithEntities()`

**Removed Functions:**
- `loadConceptMap()` - replaced by loadHumanEntity/loadPersonaEntity
- `saveConceptMap()` - replaced by saveHumanEntity/savePersonaEntity

**Removed Constants:**
- `DEFAULT_HUMAN_CONCEPTS` - replaced by DEFAULT_HUMAN_ENTITY
- `DEFAULT_SYSTEM_CONCEPTS` - replaced by DEFAULT_EI_PERSONA

### What Remains (For Other Tickets)

**Message-level concept processing** (will be removed in later tickets):
- `Message.concept_processed` field (still in types.ts, used by appendMessage/etc)
- `getUnprocessedMessages()` function
- `markMessagesConceptProcessed()` function
- concept_processed handling in appendMessage, appendHumanMessage, replacePendingMessages

These are tracked in ticket 0122 for removal once the new extraction system replaces them.

### Breaking Changes for Consuming Code

Other files that will need updates in their respective tickets:
- `concept-queue.ts` - imports ConceptMap (will be deleted in 0122)
- `concept-reconciliation.ts` - imports ConceptMap (will be deleted in 0122)
- `persona-creator.ts` - imports ConceptMap, needs to generate PersonaEntity
- `processor.ts` - imports ConceptMap, needs to use new entities
- `prompts.ts` - imports ConceptMap, needs to work with new data buckets
- `state-manager.ts` - imports ConceptMap, SystemSnapshot needs update
- `validate.ts` - imports ConceptMap (will be deleted in 0122)
- `blessed/app.ts` - uses ConceptMap in UI rendering

These are tracked in their respective epic tickets (0111-0122).
