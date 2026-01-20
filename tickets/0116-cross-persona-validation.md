# 0116: Cross-Persona Validation

**Status**: PENDING

## Summary

When a non-Ei persona updates a global (`["*"]` group) item in the human's data, Ei validates that this was intentional.

## Problem

User is roleplaying with Frodo. They jokingly say "I'm an elf" or share something personal that breaks character. The system might update global human data based on roleplay context.

## Design

### Detection Point

In the detail update flow (0112), after saving:

```typescript
async function checkCrossPersonaUpdate(
  persona: string,
  dataType: "fact" | "trait" | "topic" | "person",
  item: DataItemBase,
  isNew: boolean,
  previousGroups?: string[]
): Promise<void> {
  // Only care about updates from non-Ei personas
  if (persona === "ei") return;
  
  // Only care about global items
  const isGlobal = !item.persona_groups || 
                   item.persona_groups.length === 0 ||
                   item.persona_groups.includes("*");
  
  if (!isGlobal) return;
  
  // Queue for Ei validation
  await enqueueItem({
    type: "ei_validation",
    priority: "normal",
    payload: {
      validation_type: "cross_persona",
      item_name: item.name,
      data_type: dataType,
      context: buildCrossPersonaContext(persona, item, isNew),
      source_persona: persona
    }
  });
}

function buildCrossPersonaContext(
  persona: string,
  item: DataItemBase,
  isNew: boolean
): string {
  if (isNew) {
    return `${persona} added a new ${item.type}: "${item.name}" - ${item.description}`;
  }
  return `${persona} updated "${item.name}": ${item.description}`;
}
```

### Ei Validation Message

```typescript
function buildCrossPersonaValidationMessage(
  validations: EiValidationPayload[]
): string {
  if (validations.length === 1) {
    const v = validations[0];
    return `I noticed ${v.source_persona} ${
      v.context.includes('added') ? 'picked up' : 'updated'
    } something about you: "${v.item_name}"\n\n${v.context}\n\nWas that based on something real, or just part of your conversation with ${v.source_persona}?`;
  }
  
  // Multiple - batch
  const items = validations.map(v => 
    `- ${v.source_persona}: ${v.context}`
  ).join('\n');
  
  return `A few personas updated some general information about you:\n\n${items}\n\nAre these based on real things, or should they stay within those specific conversations?`;
}
```

### Response Options

User might say:
- "That's real" → Keep as global
- "That was just for the roleplay" → Move to persona's group
- "Remove that" → Delete the item
- Mixed responses for batched validations

```typescript
interface CrossPersonaResponse {
  keep_global: string[];     // Confirmed real
  move_to_group: Array<{
    name: string;
    group: string;          // Usually source_persona's group
  }>;
  remove: string[];
  unclear: string[];
}

async function applyCrossPersonaResults(
  results: CrossPersonaResponse,
  validations: EiValidationPayload[]
): Promise<void> {
  const entity = await loadHumanEntity();
  
  // Keep global: no action needed (already global)
  
  // Move to group: update persona_groups
  for (const { name, group } of results.move_to_group) {
    const item = findItemByName(entity, name);
    if (item) {
      item.persona_groups = [group];
    }
  }
  
  // Remove: delete from entity
  for (const name of results.remove) {
    removeItemByName(entity, name);
  }
  
  await saveHumanEntity(entity);
}
```

### Group Resolution

When moving to a group, we need to know what group to use:

```typescript
async function getPersonaGroup(persona: string): Promise<string> {
  const personaEntity = await loadPersonaEntity(persona);
  
  // Use persona's primary group if set
  if (personaEntity.group_primary) {
    return personaEntity.group_primary;
  }
  
  // Fallback: create a group named after the persona
  return persona;
}
```

## Edge Cases

1. **Persona has no group** - Create implicit group for that persona
2. **User genuinely shared real info with roleplay persona** - Keep global (that's the point of validation)
3. **Same item updated by multiple personas** - Show all in validation, let user decide

## Unsolved Problem: Roleplay Character Overlap

**Scenario**: Human's real daughter is "Betty", but in roleplay with Frodo, their character has a daughter "Alice".

If the system extracts "Daughter: Alice" from Frodo conversations, should it:
- Move "Daughter" to roleplay group? (But that's wrong - Betty is the real daughter)
- Create separate "Alice (fictional daughter)" topic? (Probably the right answer)
- Let the LLM figure it out based on context?

**Current approach**: Trust the LLM to create appropriately named/described entries. If it creates "Alice, the fictional daughter" as a topic in the Fellowship group, that's correct behavior. If it incorrectly updates "Betty" to "Alice", the Daily Ceremony validation will catch it.

This is an edge case we may need to revisit if it causes real problems.

## Acceptance Criteria

- [ ] Non-Ei global updates detected
- [ ] Validation queued with source persona context
- [ ] Ei presents validation naturally
- [ ] "Keep global" leaves item unchanged
- [ ] "Move to group" updates persona_groups
- [ ] "Remove" deletes item
- [ ] Batch handling for multiple validations
- [ ] Tests cover roleplay scenarios

## Dependencies

- 0108: Entity type definitions
- 0109: Storage
- 0110: LLM queue
- 0112: Detail updates (detection point)

## Effort Estimate

Medium (~3-4 hours)
