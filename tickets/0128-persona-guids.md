# 0128: Persona GUIDs

**Status**: QA
**Depends on**: None
**Blocked by**: None
**Priority**: CRITICAL (pre-release, 48h window)

## Summary

Replace persona name-as-identifier with proper GUID-based identification. Currently the system uses `persona.aliases[0].toLowerCase()` as the key throughout the codebase, causing:
1. **Rename brittleness**: Changing/removing the primary alias breaks everything
2. **Case sensitivity bugs**: "Sisyphus" vs "sisyphus" treated as different entities
3. **Merge conflicts**: Cross-device sync can't reliably identify same persona

This is a **clean cut** (no migration) since we haven't released yet.

## The Problem

```typescript
// Current: Name flows everywhere as identifier
Processor.sendMessage("Bob", "Hello")
  → StateManager.messages_append("Bob", message)
    → PersonaState.personas.get("bob")  // lowercase lookup

// If user removes "Bob" alias, keeps "Robert": EVERYTHING BREAKS
```

## The Solution

```typescript
// New: ID flows everywhere, name only at boundaries
Processor.sendMessage("Bob", "Hello")  // User-facing: accepts name
  → resolvePersonaByName("Bob")        // Returns PersonaEntity or null
    → stateManager.messages_append(persona.id, message)  // ID from here
      → PersonaState.personas.get(persona.id)            // Direct lookup
```

## Data Model Changes

### PersonaEntity (types.ts)

```typescript
export interface PersonaEntity {
  id: string;                    // NEW: UUID (or "ei" for built-in)
  display_name: string;          // NEW: What shows in UI
  aliases: string[];             // For fuzzy matching (user types "/persona Bob")
  entity: "system";
  // ... rest unchanged
}
```

**Special case**: Ei has `id: "ei"` (reserved). User can add aliases but identity is always "ei".

### DataItemBase (types.ts)

```typescript
export interface DataItemBase {
  id: string;
  // ...
  learned_by?: string;           // CHANGE: persona ID (was persona name)
}
```

### Quote (types.ts)

```typescript
export interface Quote {
  // ...
  speaker: "human" | string;     // CHANGE: persona ID or "human" (was persona name)
}
```

## Storage Layer Changes

### PersonaState (state/personas.ts)

```typescript
export class PersonaState {
  // CHANGE: Map key is now persona.id, not name
  private personas: Map<string, PersonaData> = new Map();

  // REMOVE: normalizeKey() - no longer needed
  
  // NEW: Fuzzy lookup by name/alias
  getByName(query: string): PersonaEntity | null {
    // 1. Exact match on display_name (case-insensitive)
    // 2. Exact match on any alias (case-insensitive)  
    // 3. Fuzzy match using fuzzysort, best score wins
    // Returns null if no match or ambiguous
  }

  // CHANGE: get() now takes ID directly
  get(id: string): PersonaEntity | null {
    return this.personas.get(id)?.entity ?? null;
  }

  // CHANGE: add() uses entity.id as key
  add(entity: PersonaEntity): void {
    this.personas.set(entity.id, { entity, messages: [] });
  }

  // CHANGE: update() takes ID
  update(id: string, updates: Partial<PersonaEntity>): boolean {
    const data = this.personas.get(id);
    if (!data) return false;
    data.entity = { ...data.entity, ...updates, last_updated: new Date().toISOString() };
    return true;
  }

  // All message methods: CHANGE parameter from personaName to personaId
  messages_get(personaId: string): Message[] { ... }
  messages_append(personaId: string, message: Message): void { ... }
  // ... etc
}
```

### StateManager (state-manager.ts)

```typescript
// NEW: Resolve name to entity (for user input)
persona_resolve(nameOrAlias: string): PersonaEntity | null {
  return this.personaState.getByName(nameOrAlias);
}

// CHANGE: get() now takes ID
persona_get(id: string): PersonaEntity | null {
  return this.personaState.get(id);
}

// CHANGE: add() takes full entity (caller generates ID)
persona_add(entity: PersonaEntity): void {
  this.personaState.add(entity);
}

// CHANGE: all methods take ID not name
persona_update(id: string, updates: Partial<PersonaEntity>): boolean
persona_archive(id: string): boolean
persona_unarchive(id: string): boolean
persona_delete(id: string): boolean

// CHANGE: message methods take persona ID
messages_get(personaId: string): Message[]
messages_append(personaId: string, message: Message): void
// ... etc
```

## Processor Changes

### User Input Boundary (processor.ts)

```typescript
// These methods accept NAME (user-facing) and resolve to ID internally:

async sendMessage(personaNameOrAlias: string, content: string): Promise<void> {
  const persona = this.stateManager.persona_resolve(personaNameOrAlias);
  if (!persona) {
    this.interface.onError?.({ code: "PERSONA_NOT_FOUND", message: `Persona "${personaNameOrAlias}" not found` });
    return;
  }
  // From here, use persona.id everywhere
  this.stateManager.messages_append(persona.id, message);
  // ... queue request with persona.id in data
}

async getPersona(nameOrAlias: string): Promise<PersonaEntity | null> {
  return this.stateManager.persona_resolve(nameOrAlias);
}

async getPersonaById(id: string): Promise<PersonaEntity | null> {
  return this.stateManager.persona_get(id);
}
```

### Internal Methods

All internal methods receive and pass `persona.id`:

```typescript
private queueHeartbeatCheck(personaId: string): void {
  const persona = this.stateManager.persona_get(personaId);
  // ...
  data: { personaId },  // CHANGE: was personaName
}

private buildResponsePromptData(personaId: string, persona: PersonaEntity): ResponsePromptData {
  // persona.display_name used for LLM display
  // persona.id used for all internal routing
}
```

### LLMRequest.data

```typescript
// CHANGE: All requests use personaId, not personaName
interface LLMRequestData {
  personaId?: string;      // For routing (CHANGE from personaName)
  // Display name extracted from entity when needed for prompts
}
```

## Handler Changes

### All Handlers (handlers/index.ts)

Every handler that currently does:
```typescript
const personaName = response.request.data.personaName as string;
const persona = state.persona_get(personaName);
state.persona_update(personaName, { ... });
state.messages_append(personaName, message);
```

Changes to:
```typescript
const personaId = response.request.data.personaId as string;
const persona = state.persona_get(personaId);
state.persona_update(personaId, { ... });
state.messages_append(personaId, message);
```

**Note**: The persona entity now has `display_name` for any prompts/logs that need it.

### Quote/DataItem Attribution

```typescript
// handlers/index.ts - handleHumanItemUpdate

// BEFORE:
learned_by: isNewItem ? personaName : existingItem?.learned_by,

// AFTER:
learned_by: isNewItem ? personaId : existingItem?.learned_by,

// For Quote.speaker:
speaker: message.role === "human" ? "human" : personaId,
```

## Prompt Data Changes

### Prompt Types (prompts/*/types.ts)

```typescript
// CHANGE: All prompt data types
interface HumanFactScanPromptData {
  persona_id: string;           // CHANGE: was persona_name
  persona_display_name: string; // NEW: for LLM display
  // ...
}

interface CeremonyPromptData {
  persona_id: string;           // CHANGE
  persona_display_name: string; // NEW
  // ...
}

// Pattern for all prompt data types
```

### Prompt Builders

Prompt builders receive `persona_display_name` for any text shown to LLM:
```typescript
const system = `You are ${data.persona_display_name}...`;
```

The `persona_id` is available if needed for any internal references.

## Queue Processor Changes

### Message Fetching (queue-processor.ts)

```typescript
// CHANGE: Fetch by ID, not name
const personaId = request.data.personaId as string | undefined;
if (personaId && this.currentMessageFetcher) {
  messages = this.currentMessageFetcher(personaId);
}

if (this.currentRawMessageFetcher) {
  const personaId = request.data.personaId as string | undefined;
  if (personaId) {
    const rawMessages = this.currentRawMessageFetcher(personaId);
    // ... hydration unchanged (uses message.id)
  }
}
```

## Orchestrator Changes

### All Orchestrators (orchestrators/*.ts)

Same pattern as handlers - change from `personaName` to `personaId`:

```typescript
// ceremony.ts
export function queueExposurePhase(personaId: string, state: StateManager): void {
  const messages = state.messages_get(personaId);
  // ...
  data: { personaId },
}

// persona-generation.ts
stateManager.persona_update(persona.id, { ... });

// human-extraction.ts, persona-topics.ts - same pattern
```

## Persona Creation

### New Persona Flow

```typescript
// processor.ts
async createPersona(input: PersonaCreationInput): Promise<PersonaEntity> {
  const id = crypto.randomUUID();
  const entity: PersonaEntity = {
    id,
    display_name: input.name,           // User's chosen name becomes display_name
    aliases: [input.name.toLowerCase()], // And an alias for fuzzy match
    // ... rest of defaults
  };
  this.stateManager.persona_add(entity);
  return entity;
}

// Ei special case (on first run):
const eiEntity: PersonaEntity = {
  id: "ei",  // Reserved ID
  display_name: "Ei",
  aliases: ["ei"],
  // ...
};
```

## Fuzzy Name Resolution

### Implementation

Add `fuzzysort` as dependency:
```bash
npm install fuzzysort
```

```typescript
// state/personas.ts
import fuzzysort from 'fuzzysort';

getByName(query: string): PersonaEntity | null {
  const queryLower = query.toLowerCase();
  
  // 1. Exact match on display_name
  for (const data of this.personas.values()) {
    if (data.entity.display_name.toLowerCase() === queryLower) {
      return data.entity;
    }
  }
  
  // 2. Exact match on any alias
  for (const data of this.personas.values()) {
    if (data.entity.aliases.some(a => a.toLowerCase() === queryLower)) {
      return data.entity;
    }
  }
  
  // 3. Fuzzy match - collect all aliases with their personas
  const targets: Array<{ text: string; persona: PersonaEntity }> = [];
  for (const data of this.personas.values()) {
    targets.push({ text: data.entity.display_name, persona: data.entity });
    for (const alias of data.entity.aliases) {
      targets.push({ text: alias, persona: data.entity });
    }
  }
  
  const results = fuzzysort.go(query, targets, { key: 'text', threshold: -10000 });
  if (results.length > 0) {
    return results[0].obj.persona;
  }
  
  return null;
}
```

## CLI Verification

### CLI Commands (cli.ts, cli/retrieval.ts)

Verify these still work after changes:
- `ei quotes` - should resolve persona names in output
- `ei facts` - same
- Any command that displays persona attribution

CLI should use `persona.display_name` for output, not ID.

## TUI Changes

### Slash Commands (tui/src/commands/*.ts)

Commands that accept persona names should call `processor.getPersona(name)` (which does fuzzy resolution) and then use the returned entity's `id` for subsequent operations.

```typescript
// /persona command
const persona = await processor.getPersona(userInput);
if (!persona) {
  return `Persona "${userInput}" not found`;
}
// Use persona.id for any state changes
```

## Acceptance Criteria

### Phase 1: Data Model
- [x] Add `id: string` to PersonaEntity
- [x] Add `display_name: string` to PersonaEntity
- [x] Change `DataItemBase.learned_by` to store persona ID
- [x] Change `Quote.speaker` to store persona ID (or "human")
- [x] Update `PersonaCreationInput` if needed

### Phase 2: Storage Layer
- [x] Update PersonaState to key by `id`
- [x] Add `getByName()` fuzzy lookup
- [x] Update all PersonaState methods to use ID
- [x] Update StateManager methods to use ID
- [x] Add `persona_resolve()` for name→entity lookup

### Phase 3: Processor Boundary
- [x] `sendMessage()` resolves name to ID at entry
- [x] `getPersona()` returns entity by fuzzy name match
- [x] `getPersonaById()` returns entity by direct ID
- [x] `createPersona()` generates UUID and sets display_name
- [x] Ei initialization uses reserved ID "ei"
- [x] All internal methods pass ID, not name

### Phase 4: Handlers
- [x] Change all `personaName` extractions to `personaId`
- [x] Update all `persona_get()` calls
- [x] Update all `persona_update()` calls
- [x] Update all `messages_*()` calls
- [x] Update `learned_by` assignment to use ID
- [x] Update `Quote.speaker` assignment to use ID

### Phase 5: Orchestrators
- [x] Update ceremony.ts - all functions use ID
- [x] Update persona-generation.ts
- [x] Update human-extraction.ts
- [x] Update persona-topics.ts
- [x] Update extraction-chunker.ts

### Phase 6: Prompts
- [x] Add `persona_display_name` to all prompt data types
- [x] Change `persona_name` to `persona_id` in types
- [x] Update prompt builders to use display_name for LLM text

### Phase 7: Queue Processor
- [x] Change message fetching to use `personaId`
- [x] Verify hydration still works (uses message.id, should be fine)

### Phase 8: Dependencies & Testing
- [x] Add `fuzzysort` dependency
- [x] Update unit tests for new signatures
- [x] Verify CLI still works
- [x] Verify TUI slash commands still work
- [ ] E2E: Create persona, rename alias, send message - should work

## Files to Modify

### Core Types
- `src/core/types.ts` - PersonaEntity, DataItemBase, Quote

### Storage
- `src/core/state/personas.ts` - Complete rewrite of key structure
- `src/core/state-manager.ts` - Update all persona/message method signatures

### Processor
- `src/core/processor.ts` - User boundary, internal method signatures

### Queue
- `src/core/queue-processor.ts` - Message fetching

### Handlers
- `src/core/handlers/index.ts` - ~100 changes from personaName→personaId

### Orchestrators
- `src/core/orchestrators/ceremony.ts`
- `src/core/orchestrators/persona-generation.ts`
- `src/core/orchestrators/human-extraction.ts`
- `src/core/orchestrators/persona-topics.ts`
- `src/core/orchestrators/extraction-chunker.ts`

### Prompts
- `src/prompts/human/types.ts`
- `src/prompts/persona/types.ts`
- `src/prompts/ceremony/types.ts`
- `src/prompts/*/index.ts` - Where data is constructed

### CLI
- `src/cli.ts`
- `src/cli/retrieval.ts`

### TUI
- `tui/src/commands/*.ts` - Slash command handlers

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Miss a personaName reference | Grep thoroughly, TypeScript will catch type mismatches |
| Fuzzy match returns wrong persona | Exact match takes priority, threshold tuning |
| CLI breaks | Explicit testing in acceptance criteria |
| Performance (fuzzy on every lookup) | Only at user boundary, not internal paths |

## Notes

- This is a **breaking change** for any saved state - but we're pre-release
- 48-hour window before this becomes migration territory
- Ei's reserved ID "ei" means it can never be confused with a user-created persona
- `display_name` separate from aliases means renaming is safe

## Related Tickets

- **0106**: RemoteStorage Implementation - YOLO Merge depends on this for reliable persona matching
- **0146**: Write-Through Storage - Should be done AFTER this ticket
