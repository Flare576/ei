# 0123: PersonaTopic Data Model Separation

**Status**: PENDING
**Priority**: HIGH
**Epic**: E009 (Polish & New Features)
**Depends on**: None
**Blocked by**: None

## Summary

Separate `PersonaTopic` from `Topic` (Human.Topic) because they serve fundamentally different purposes and have been awkwardly sharing the same data structure.

## Background

### The Problem

Currently, `PersonaEntity.topics` uses the same `Topic` interface as `HumanEntity.topics`. But they serve completely different purposes:

| Aspect | Human.Topic | Persona.Topic |
|--------|-------------|---------------|
| **Purpose** | What the human knows/feels about a topic | How the persona engages with a topic |
| **Description** | Factual/emotional content | Should be: perspective, approach, stake |
| **Visibility** | Shared across personas (via `persona_groups`) | Persona-local (lives on PersonaEntity) |
| **Discovery** | Learned by personas, validated by Ei | Generated during Ceremony |

### Design Decision

Rather than stuffing JSON into the `description` field (hacky), we're creating a proper `PersonaTopic` interface that reflects what persona topics actually need.

## New Data Model

```typescript
interface PersonaTopic {
  id: string;
  name: string;
  perspective: string;      // Their view/opinion on this topic
  approach: string;         // How they prefer to engage with this topic
  personal_stake: string;   // Why this topic matters to them personally
  sentiment: number;        // -1.0 to 1.0 (how they feel about it)
  exposure_current: number; // 0.0 to 1.0 (how recently discussed)
  exposure_desired: number; // 0.0 to 1.0 (how much they want to discuss)
  last_updated: string;     // ISO timestamp
}
```

**What's NOT included (intentionally):**
- `learned_by` - persona topics aren't "learned", they're generated
- `persona_groups` - persona topics are persona-local, no cross-visibility needed
- `description` - replaced by structured fields

## Acceptance Criteria

### Part 1: Type Definitions
- [ ] Create `PersonaTopic` interface in `src/core/types.ts`
- [ ] Update `PersonaEntity.topics` to use `PersonaTopic[]` instead of `Topic[]`
- [ ] Update `CONTRACTS.md` with new interface and explanation

### Part 2: Update Existing Code
- [ ] Update `src/prompts/response/sections.ts` - `buildTopicsSection()` to handle PersonaTopic
- [ ] Update `src/prompts/response/types.ts` - ResponsePromptData.persona.topics type
- [ ] Update `src/prompts/heartbeat/check.ts` - uses persona.topics
- [ ] Update `src/prompts/heartbeat/types.ts` - HeartbeatCheckPromptData.persona.topics
- [ ] Update Ceremony phases that touch persona topics:
  - `src/core/ceremony/decay.ts`
  - `src/core/ceremony/expire.ts`
  - `src/core/ceremony/explore.ts`
- [ ] Update persona generation prompts if they create initial topics

### Part 3: Prompt Display Updates
- [ ] When displaying PersonaTopic in prompts, format the structured fields nicely:
  ```
  - **Topic Name** (sentiment: positive)
    Perspective: {perspective}
    Approach: {approach}
    Stake: {personal_stake}
  ```
- [ ] Or keep it simple initially - just use `perspective` as the display text

## Implementation Notes

### Migration Strategy

Existing persona topics have a `description` string. During this ticket:
1. Old `description` content → `perspective` field
2. `approach` → empty string (will be populated by Ceremony)
3. `personal_stake` → empty string (will be populated by Ceremony)

This can be done lazily (check for old format, migrate on read) or eagerly (migration script). Lazy is probably fine since Flare resets frequently.

### Files to Check/Update

```
src/core/types.ts                    # Add PersonaTopic, update PersonaEntity
src/prompts/response/sections.ts     # buildTopicsSection uses persona.topics
src/prompts/response/types.ts        # ResponsePromptData.persona.topics
src/prompts/heartbeat/check.ts       # Uses persona.topics
src/prompts/heartbeat/types.ts       # HeartbeatCheckPromptData
src/core/ceremony/decay.ts           # Modifies persona topics
src/core/ceremony/expire.ts          # Removes persona topics
src/core/ceremony/explore.ts         # Creates new persona topics
src/prompts/persona/generation.ts    # May create initial topics
src/prompts/persona/descriptions.ts  # Uses persona topics
CONTRACTS.md                         # Document the new type
```

### Handling Empty Fields

The new `approach` and `personal_stake` fields will be empty initially. Prompts should handle this gracefully:
- If empty, don't display that section
- Or display "Not yet established" or similar

### No Schema Migration Needed

`PersonaTopic` is still just a TypeScript interface - it's stored as JSON in localStorage/checkpoints. The shape changes, but storage doesn't care.

## Testing

- [ ] Build passes with new types
- [ ] Existing tests pass (may need fixture updates)
- [ ] Ceremony phases work with new PersonaTopic structure
- [ ] Response prompts display persona topics correctly
- [ ] Heartbeat prompts work with new structure

## Related

- **0124**: Persona Topic Ceremony Redesign - will populate the new structured fields
- This ticket creates the data model; 0124 creates the prompts to fill it
