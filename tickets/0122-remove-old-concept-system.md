# 0122: Remove Old Concept System

**Status**: PENDING

## Summary

Clean up all remnants of the old `Concept` and `ConceptMap` system once the new entity architecture is in place.

## Implementation Notes

### New Code Added (NOT for removal)

The following files/functions were added as part of the new entity architecture and should **NOT** be removed:

**src/extraction.ts** (ticket 0112):
- `buildFactDetailPrompt()` - NEW, part of Phase 2 extraction
- `buildTraitDetailPrompt()` - NEW, part of Phase 2 extraction
- `buildTopicDetailPrompt()` - NEW, part of Phase 2 extraction
- `buildPersonDetailPrompt()` - NEW, part of Phase 2 extraction
- `runDetailUpdate()` - NEW, Phase 2 execution logic
- `findItemByName()`, `upsertItem()`, `validateDetailResult()` - NEW helper functions
- `maybeRegeneratePersonaDescriptions()` - NEW, queues description regen (awaiting PersonaEntity-based implementation in 0122)

**src/queue-processor.ts** (ticket 0126):
- `executeDetailUpdate()` - Updated to call `runDetailUpdate()` from extraction.ts

## Changes Made in 0109 (Storage Migration)

The following items were already completed as part of ticket 0109:

**storage.ts - Deleted/Replaced:**
- ✅ Removed `DEFAULT_HUMAN_CONCEPTS` → replaced with `DEFAULT_HUMAN_ENTITY`
- ✅ Removed `DEFAULT_SYSTEM_CONCEPTS` → replaced with `DEFAULT_EI_PERSONA` (with "Warm but Direct" trait)
- ✅ Removed `loadConceptMap()` → replaced with `loadHumanEntity()` and `loadPersonaEntity()`
- ✅ Removed `saveConceptMap()` → replaced with `saveHumanEntity()` and `savePersonaEntity()`
- ✅ Updated `initializeDataDirectory()` to use new entity types
- ✅ Updated `listPersonas()` to use PersonaEntity
- ✅ Renamed `PersonaWithConceptMap` → `PersonaWithEntity`
- ✅ Renamed `loadAllPersonasWithConceptMaps()` → `loadAllPersonasWithEntities()`
- ✅ Updated `getArchivedPersonas()` to use PersonaEntity
- ✅ Updated `addPersonaAlias()` to use PersonaEntity
- ✅ Updated `removePersonaAlias()` to use PersonaEntity
- ✅ Updated `saveNewPersona()` signature: `ConceptMap` → `PersonaEntity`
- ✅ Updated `loadPauseState()` / `savePauseState()` to use PersonaEntity
- ✅ Updated `loadArchiveState()` / `saveArchiveState()` to use PersonaEntity
- ✅ Removed import of `ConceptMap` from types.ts
- ✅ Added import of `HumanEntity` and `PersonaEntity` from types.ts

**storage.ts - Still Remaining:**
- Message-level concept processing functions (`markMessagesConceptProcessed`, `getUnprocessedMessages`)
- `concept_processed` field handling in message operations

## Files to Update

### src/types.ts
- [x] Remove `ConceptType` (done in 0108)
- [x] Remove `Concept` interface (done in 0108)
- [x] Remove `ConceptMap` interface (done in 0108)
- [x] Remove `ConceptMapUpdate` interface (done in 0108)
- [x] Update `ProcessEventInput` to use entity types (done in 0108)
- [x] Update `SystemSnapshot` to use entity types (done in 0108)
- [x] Remove `Message.concept_processed` field **[Deleted in 0110]**
  - Replacement: LLM queue tracking (ticket 0110)

### src/storage.ts
- [x] Remove `DEFAULT_SYSTEM_CONCEPTS` **[Deleted in 0109]**
- [x] Remove `loadConceptMap` / `saveConceptMap` **[Deleted in 0109]**
- [x] Remove `DEFAULT_HUMAN_CONCEPTS` **[Deleted in 0109]** - replaced with DEFAULT_HUMAN_ENTITY
- [x] `PersonaWithConceptMap` interface renamed to `PersonaWithEntity` **[Deleted in 0109]**
- [x] `loadAllPersonasWithConceptMaps()` renamed to `loadAllPersonasWithEntities()` **[Deleted in 0109]**
- [x] All ConceptMap parameters updated to PersonaEntity **[Deleted in 0109]**
- [x] Remove `markMessagesConceptProcessed()` function **[Deleted in 0110]**
- [x] Remove `getUnprocessedMessages()` function **[Deleted in 0110]**
- [x] Remove all `concept_processed` field handling **[Deleted in 0110]**
- [x] Update message creation to remove `concept_processed: false` initialization **[Deleted in 0110]**

### src/prompts.ts
- [x] Rebuild `buildResponseSystemPrompt` (done in 0119)
- [x] Remove `MUTABLE_TYPES` constant (line 3) **[Deleted in 0111]**
- [x] Remove `buildConceptUpdateSystemPrompt` (lines 306-439) **[Deleted in 0111]** - replaced by extraction.ts fast-scan and detail prompts
- [x] Remove `buildConceptUpdateUserPrompt` (lines 441-461) **[Deleted in 0111]** - replaced by extraction.ts
- [x] Remove `formatConceptsByType` function (lines 84-99) **[Deleted in 0111]**
- [x] Remove `getHighestNeedConcepts` function (lines 101-109) **[Deleted in 0111]**
- [x] Remove `stripConceptMetaFieldsForLLM` function (lines 5-14) **[Deleted in 0111]**
- [ ] Update `getVisibleConcepts` (lines 18-34) → new visibility logic for data buckets
- [ ] Update all `ConceptMap` parameters to `PersonaEntity`/`HumanEntity`
- [ ] Remove type-based filtering throughout (all `c.type === "X"` checks) - **[buildResponseSystemPrompt and buildDescriptionPrompt still use old structures]**

### src/processor.ts
- [ ] Remove `conceptsChanged` helper function (lines 26-47)
- [ ] Remove `ProcessResult.humanConceptsUpdated` field (line 76 - already marked deprecated)
- [ ] Remove `ProcessResult.systemConceptsUpdated` field (line 78 - already marked deprecated)
- [ ] Update `processEvent` to use new entity types
- [ ] Remove all concept update orchestration (replaced by new extraction system)
- [ ] Update imports to remove `Concept`, `ConceptMap`

### src/validate.ts
- [x] Remove static concept validation (done in 0120)
- [ ] **DELETE ENTIRE FILE** (77 lines)
  - `STATIC_CONCEPT_NAMES` array (lines 3-11)
  - `validateSystemConcepts()` function (lines 13-47)
  - `mergeWithOriginalStatics()` function (lines 49-76)
  - All static concept validation logic
- [ ] Remove imports from processor.ts, concept-queue.ts

### src/concept-reconciliation.ts
- [ ] **DELETE ENTIRE FILE OR HEAVILY REWRITE** (53 lines)
  - `GLOBAL_GROUP` constant might stay but logic changes
  - `reconcileConceptGroups()` function operates on wrong data structure
  - Reconciliation happens at DataItem level, not Concept level
  - Group assignment logic moves to entity-level operations

### src/concept-decay.ts
- [x] **DELETED in ticket 0113** - Replaced by src/topic-decay.ts
- [x] New topic-decay.ts works with Topic/Person types directly
- [x] Same logarithmic decay formula, cleaner implementation

### src/concept-queue.ts
- [x] Replace with LLM queue (done in 0110)
- [x] **DELETED ENTIRE FILE** **[Deleted in 0110]**
  - Replaced by `src/llm-queue.ts` with new queue types and persistence

### src/persona-creator.ts
- [ ] Remove all static concept definitions (lines 7-63)
  - Hardcoded "Promote Human-to-Human Interaction"
  - Hardcoded "Respect Conversational Boundaries"
  - Hardcoded "Maintain Identity Coherence"
  - Hardcoded "Emotional Authenticity Over Sycophancy"
  - Hardcoded "Transparency About Nature"
  - Hardcoded "Encourage Growth Over Comfort"
  - Hardcoded "Context-Aware Proactive Timing"
- [ ] Update `generatePersonaDescriptions` to return PersonaEntity structure **[Required for 0112 - description_regen]**
- [ ] Add optional seed trait generation (e.g., "Warm but Direct" for Ei)
- [ ] Simplify to identity generation only (aliases + descriptions)

### src/blessed/app.ts
- [x] Remove `concept_processed: true` assignment **[Deleted in 0110]**
- [x] Remove `ConceptQueue` imports and usage **[Deleted in 0110]**
- [x] Remove stale message checking logic **[Deleted in 0110]** (stubbed out, will be replaced by LLM queue)
- [x] Remove `getUnprocessedMessages` import **[Deleted in 0110]**
- [x] Remove stale `loadConceptMap`, `saveConceptMap`, `loadAllPersonasWithConceptMaps` imports **[Deleted in 0126]**
- [x] Replace concept-decay imports with topic-decay **[Updated in 0113]**
  - Changed `applyConceptDecay` → `applyTopicDecay('system', personaName)`
  - Changed `checkConceptDeltas` → `checkDesireGaps('system', personaName)`
- [ ] Update concept display logic to show data buckets (facts/traits/topics/people)
- [ ] Remove type-based filtering in UI rendering (lines 922, 1246, 1278, 1329)
- [ ] Fix remaining `loadConceptMap`/`saveConceptMap` function calls (lines 923-1333)
- [ ] [Needed throughout epic - UI changes span multiple tickets]

## Tests to Update

### tests/unit/
- [x] concept-decay.test.ts **DELETED in 0113** → Replaced by topic-decay.test.ts
- [ ] concept-reconciliation.test.ts → entity-reconciliation.test.ts
- [ ] concept-visibility.test.ts → entity-visibility.test.ts
- [ ] processor.test.ts → update for new flow
- [ ] prompts.test.ts → update for new prompt structure

### tests/integration/
- [ ] Any concept-related integration tests

## Detailed Removal Inventory

### 1. Message.concept_processed Field **[COMPLETED in 0110]**
**All removed** - ✅ Ticket 0110 removed all occurrences:
- ✅ `src/types.ts:219` - Field definition removed
- ✅ `src/storage.ts` - All initialization removed (was lines 179, 194, 260)
- ✅ `src/storage.ts:245-257` - `getUnprocessedMessages()` deleted
- ✅ `src/storage.ts:264-281` - `markMessagesConceptProcessed()` deleted
- ✅ `src/blessed/app.ts:1477` - Removed from marker message

**Replacement**: LLM queue tracking (ticket 0110)

### 2. ConceptType Enum and Type-Based Switching
**Locations**: 37+ occurrences across 7 files
- `prompts.ts:3` - `MUTABLE_TYPES` constant
- `prompts.ts:97-112` - `formatConceptsByType()` function
- `prompts.ts:195-196` - Static concept section in prompts
- `prompts.ts:355, 367, 458` - Type documentation
- `prompts.ts:507` - Static concept filtering
- `storage.ts:49, 57, 65, 73, 81, 89, 97` - Type assignments in DEFAULT_SYSTEM_CONCEPTS
- `validate.ts:29-42` - Type validation checks
- `persona-creator.ts:13, 21, 29, 37, 45, 53, 61` - Type assignments

**Replacement**: Separate data buckets (facts/traits/topics/people arrays)

### 3. Static Concept System
**Files to Delete**:
- `src/validate.ts` (77 lines) - **DELETE ENTIRE FILE**
  - `STATIC_CONCEPT_NAMES` array
  - `validateSystemConcepts()` function
  - `mergeWithOriginalStatics()` function

**Data to Remove**:
- `storage.ts:36-100` - All 7 static concept definitions in DEFAULT_SYSTEM_CONCEPTS
- `persona-creator.ts:7-63` - Hardcoded static concepts
- All validation checks for static concepts
- All prompt sections formatting static concepts

**Replacement**: Baked into prompt templates (ticket 0120)

### 4. DEFAULT Entity Structures **[Deleted in 0109]**
**OLD** (storage.ts:30-100) - **REMOVED**:
```typescript
const DEFAULT_HUMAN_CONCEPTS: ConceptMap = {
  entity: "human",
  last_updated: null,
  concepts: []
};

const DEFAULT_SYSTEM_CONCEPTS: ConceptMap = {
  entity: "system",
  aliases: ["default", "core"],
  group_primary: null,
  groups_visible: ["*"],
  last_updated: null,
  concepts: [/* 7 static concepts */]
};
```

**NEW** (implemented in 0109):
```typescript
const DEFAULT_HUMAN_ENTITY: HumanEntity = {
  entity: "human",
  facts: [],
  traits: [],
  topics: [],
  people: [],
  last_updated: null
};

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
  topics: [],
  last_updated: null
};
```

### 5. Storage Layer Functions (storage.ts) **[Partially Deleted in 0109]**
**Functions Replaced in 0109**:
- ✅ `loadConceptMap()` → `loadHumanEntity()`, `loadPersonaEntity()` **[Deleted in 0109]**
- ✅ `saveConceptMap()` → `saveHumanEntity()`, `savePersonaEntity()` **[Deleted in 0109]**
- ✅ `saveNewPersona(personaName, ConceptMap)` → `saveNewPersona(personaName, PersonaEntity)` **[Updated in 0109]**
- ✅ `loadPauseState()` / `savePauseState()` → Updated to use PersonaEntity **[Updated in 0109]**
- ✅ `loadArchiveState()` / `saveArchiveState()` → Updated to use PersonaEntity **[Updated in 0109]**
- ✅ `addPersonaAlias()` / `removePersonaAlias()` → Updated to use PersonaEntity **[Updated in 0109]**

**Functions Removed in 0110**:
- ✅ `markMessagesConceptProcessed()` **[Deleted in 0110]**
- ✅ `getUnprocessedMessages()` **[Deleted in 0110]**
- ✅ All `concept_processed` field initialization **[Deleted in 0110]**

**Functions to Keep** (not concept-specific):
- `loadHistory()`, `saveHistory()`, `appendMessage()`
- `getRecentMessages()`, `getLastMessageTime()`
- File path helpers: `dataPath()`, `personaPath()`, `getDataPath()`

### 6. Concept Queue System **[COMPLETED in 0110]**
**File Deleted**: ✅ `src/concept-queue.ts` - **DELETED ENTIRE FILE** in ticket 0110

**Replacement**: ✅ New `src/llm-queue.ts` with persistence to `data/llm_queue.jsonc` (ticket 0110)

### 7. Concept Reconciliation
**File to Delete/Rewrite**:
- `src/concept-reconciliation.ts` - **DELETE OR HEAVILY REWRITE** (53 lines)
  - `GLOBAL_GROUP` constant might stay
  - `reconcileConceptGroups()` operates on wrong data structure

**Replacement**: Group assignment happens at DataItem creation time in new storage functions

### 8. Processor Functions
**Functions to Remove** (processor.ts):
- `conceptsChanged()` (lines 26-47) - Replaced by per-data-type change detection
- Concept update orchestration logic - Replaced by new extraction system

**Fields to Remove** (already deprecated):
- `ProcessResult.humanConceptsUpdated`
- `ProcessResult.systemConceptsUpdated`

### 9. Prompt Building Functions **[Partially Deleted in 0111]**
**Functions Removed in 0111** (prompts.ts):
- ✅ `buildConceptUpdateSystemPrompt()` (lines 306-439) - Replaced by src/extraction.ts **[Deleted in 0111]**
- ✅ `buildConceptUpdateUserPrompt()` (lines 441-461) - Replaced by src/extraction.ts **[Deleted in 0111]**
- ✅ `stripConceptMetaFieldsForLLM()` (lines 5-14) **[Deleted in 0111]**
- ✅ `formatConceptsByType()` (lines 84-99) **[Deleted in 0111]**
- ✅ `getHighestNeedConcepts()` (lines 101-109) **[Deleted in 0111]**
- ✅ `MUTABLE_TYPES` constant (line 3) **[Deleted in 0111]**

**Functions to Update**:
- `getVisibleConcepts()` (lines 18-34) → Filter per data bucket, not concepts
- All functions taking `ConceptMap` → Update to `PersonaEntity`/`HumanEntity`
- `buildResponseSystemPrompt()` still uses old Concept structures
- `buildDescriptionPrompt()` still uses old Concept structures

### 10. Persona Creator Updates
**Remove** (persona-creator.ts):
- All static concept definitions (lines 7-63)
- Concept array generation logic

**Update**:
- Return PersonaEntity structure
- Generate aliases + descriptions only
- Optional: Seed traits (e.g., "Warm but Direct" for Ei)

## Search Patterns

To find remaining references:
```bash
# Find all concept references
grep -r "Concept" src/ --include="*.ts"
grep -r "ConceptMap" src/ --include="*.ts"
grep -r "ConceptType" src/ --include="*.ts"

# Find old function calls
grep -r "loadConceptMap" src/ --include="*.ts"
grep -r "saveConceptMap" src/ --include="*.ts"
grep -r "buildConceptUpdate" src/ --include="*.ts"
grep -r "concept_processed" src/ --include="*.ts"
grep -r "formatConceptsByType" src/ --include="*.ts"
grep -r "MUTABLE_TYPES" src/ --include="*.ts"
grep -r "static.*type:" src/ --include="*.ts"
```

## Order of Operations

1. Ensure all new code is in place (0108-0121)
2. Update consumers one at a time, running tests after each
3. Delete old files/functions only after consumers updated
4. Final grep to catch stragglers

## Summary Statistics

**Entire files to delete**:
1. `src/validate.ts` (77 lines)
2. `src/concept-reconciliation.ts` (53 lines - or heavily rewrite)
3. `src/concept-queue.ts` (entire background queue system - replaced in 0110-0113)

**Major refactors needed**:
1. `src/storage.ts` - All ConceptMap functions → Entity functions
2. `src/prompts.ts` - Remove type-based switching, add data-type-specific builders
3. `src/processor.ts` - Remove concept update orchestration
4. `src/persona-creator.ts` - Remove static concepts, simplify to identity only
5. `src/blessed/app.ts` - UI concept rendering → data bucket rendering

**Small removals**:
- `Message.concept_processed` field + all related logic (~10 occurrences)
- `ProcessResult` deprecated fields (2 fields)
- Type constants like `MUTABLE_TYPES`
- Static concept arrays in defaults (~60 lines)

**Total cleanup estimate**: ~300-400 lines of code removal, ~500-600 lines of refactoring

## Acceptance Criteria

- [ ] No references to `Concept` type remain (except in git history)
- [ ] No references to `ConceptMap` remain
- [ ] No references to `ConceptType` remain
- [ ] `Message.concept_processed` field removed
- [ ] `validate.ts` deleted
- [ ] `concept-reconciliation.ts` deleted or repurposed
- [ ] `concept-queue.ts` deleted (replaced by new extraction system)
- [ ] `DEFAULT_HUMAN_CONCEPTS` → `DEFAULT_HUMAN_ENTITY`
- [ ] `DEFAULT_SYSTEM_CONCEPTS` → `DEFAULT_PERSONA_ENTITY` (no static concepts)
- [ ] Old prompt builders removed (`buildConceptUpdate*`, `formatConceptsByType`, etc.)
- [ ] Old storage functions removed (`loadConceptMap`, `saveConceptMap`, etc.)
- [ ] Static concept system completely removed
- [ ] All tests pass
- [ ] Build succeeds with no type errors

## Dependencies

- All other 0107 sub-tickets must be complete

## Effort Estimate

Medium (~3-4 hours)

## Notes

This is a cleanup ticket - do it last. The goal is a clean codebase with no vestigial concept code.

### Items Flagged as Needed by Other Tickets

- **[Needed for 0113]** `src/concept-decay.ts` - Decay logic still needed, just operates on Topic/Person types instead of Concept
- **[Needed throughout epic]** `src/blessed/app.ts` UI changes - span multiple tickets, can't fully clean until end

### Migration Strategy

Since we're not supporting backward compatibility, we can be aggressive with deletions:
1. Delete entire files once their replacement is in place
2. Don't maintain parallel code paths
3. Let the build break and fix forward
4. Use TypeScript errors as a checklist

This is a "scorched earth" migration - cleaner to rebuild than to maintain legacy code during transition.
