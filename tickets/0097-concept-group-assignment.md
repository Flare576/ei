# 0097: Concept Group Assignment Logic

**Status**: PENDING

## Summary
Implement hybrid LLM + code approach to manage `persona_groups` field on concepts.

## Parent Epic
0094: Group-Based Concept Visibility System

## Problem
LLM needs to update concept levels/sentiment/descriptions, but `persona_groups` should be managed by code to ensure consistency.

## Approach

### LLM responsibilities (concept map prompt):
- Update `level_current`, `level_ideal`, `sentiment`, `description`
- Add new concepts (without `persona_groups` - code handles this)
- Remove concepts (return reduced list)

### Code responsibilities (post-LLM processing):

```typescript
function reconcileConceptGroups(
  existingConcepts: HumanConcept[],
  llmUpdatedConcepts: HumanConcept[],
  persona: Persona
): HumanConcept[] {
  const reconciled: HumanConcept[] = [];
  
  for (const updated of llmUpdatedConcepts) {
    const existing = existingConcepts.find(c => c.label === updated.label);
    
    if (existing) {
      // Existing concept: merge LLM updates + ensure group membership
      const personaGroups = new Set(existing.persona_groups);
      if (persona.group_primary) {
        personaGroups.add(persona.group_primary);
      }
      
      reconciled.push({
        ...updated,
        persona_groups: Array.from(personaGroups),
        last_updated: new Date().toISOString(),
        last_updated_by: persona.name,
      });
    } else {
      // New concept: set initial groups
      reconciled.push({
        ...updated,
        persona_groups: persona.group_primary ? [persona.group_primary] : [],
        learned_by: persona.name,
        added: new Date().toISOString(),
      });
    }
  }
  
  // Handle removed concepts - keep them but don't include in reconciled
  // They'll be filtered out naturally
  
  return reconciled;
}
```

## Prompt Updates
- Remove any instructions about managing `persona_groups` from LLM prompts
- LLM should NOT receive or output `persona_groups` field at all
- Code adds it post-processing

## Acceptance Criteria
- [ ] LLM prompts do NOT include `persona_groups` field in schema shown to model
- [ ] LLM prompts do NOT instruct model to manage `persona_groups`
- [ ] New concepts created by persona in group "Work" get `persona_groups: ["Work"]`
- [ ] New concepts created by persona with no group get `persona_groups: []`
- [ ] Existing concept discussed by persona in group "Personal" adds "Personal" to `persona_groups`
- [ ] Concept with `persona_groups: ["Work"]` keeps "Work" when discussed by "Personal" persona (accumulates groups)
- [ ] `last_updated` and `last_updated_by` set by code after LLM response
- [ ] `learned_by` and `added` set for new concepts
- [ ] Concepts removed by LLM are handled gracefully (filtered out)
- [ ] Code reconciliation tested with various scenarios (new, updated, removed concepts)

## Dependencies
- 0096: Concept Visibility Filtering

## Effort Estimate
Medium (~3-4 hours)
