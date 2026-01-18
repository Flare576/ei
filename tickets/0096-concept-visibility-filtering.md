# 0096: Concept Visibility Filtering

**Status**: PENDING

## Summary
Implement filtering logic to show personas only concepts from their visible groups.

## Parent Epic
0094: Group-Based Concept Visibility System

## Core Logic

```typescript
function getVisibleConcepts(persona: Persona, allConcepts: HumanConcept[]): HumanConcept[] {
  // Ei sees everything
  if (persona.groups_visible?.includes("*")) {
    return allConcepts;
  }
  
  // Build visible groups: primary + explicitly visible
  const visibleGroups = new Set<string>();
  if (persona.group_primary) {
    visibleGroups.add(persona.group_primary);
  }
  (persona.groups_visible || []).forEach(g => visibleGroups.add(g));
  
  return allConcepts.filter(concept => {
    // Global concepts (empty persona_groups) visible to all
    if (concept.persona_groups.length === 0) return true;
    
    // Check if any concept group matches persona's visible groups
    return concept.persona_groups.some(g => visibleGroups.has(g));
  });
}
```

## Integration Points
- `buildResponseSystemPrompt()` - filter concepts before passing
- `buildHumanConceptMapPrompt()` - filter concepts for update
- Any other function that reads human concepts for a persona

## Acceptance Criteria
- [ ] `getVisibleConcepts()` utility function implemented in appropriate module
- [ ] Persona with `group_primary: "Work"` sees concepts with `persona_groups: ["Work"]`
- [ ] Persona with `group_primary: "Work"` sees concepts with `persona_groups: []` (global)
- [ ] Persona with `group_primary: "Work"` does NOT see concepts with only `persona_groups: ["Personal"]`
- [ ] Persona with `group_primary: "Work"` and `groups_visible: ["Personal"]` sees BOTH "Work" and "Personal" concepts
- [ ] Ei (`groups_visible: ["*"]`) sees ALL concepts regardless of `persona_groups`
- [ ] Persona with no groups (`group_primary: null`, `groups_visible: []`) sees only global concepts
- [ ] Response system prompts include only visible concepts
- [ ] Concept map prompts include only visible concepts
- [ ] Unit tests cover all visibility scenarios

## Dependencies
- 0095: Schema Changes - Group Fields

## Effort Estimate
Medium (~2-3 hours)
