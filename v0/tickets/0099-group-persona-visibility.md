# 0099: Group-Based Persona Visibility

**Status**: DONE

## Summary
Replace mingle flag concept with group-based persona visibility (personas see other personas in their groups).

## Parent Epic
0094: Group-Based Concept Visibility System

## Current Behavior (Ticket 0049 - never implemented)
- `mingle: true` -> see all other mingle personas
- `mingle: false` -> isolated

## New Behavior
- Personas see other personas whose `group_primary` is in their visible groups
- Ei always sees all personas
- Personas with no groups see only Ei

## Logic

```typescript
function getVisiblePersonas(currentPersona: Persona, allPersonas: Persona[]): Persona[] {
  // Ei sees everyone
  if (currentPersona.name === "ei") {
    return allPersonas.filter(p => p.name !== "ei");
  }
  
  const visible: Persona[] = [];
  
  // Build visible groups for current persona
  const visibleGroups = new Set<string>();
  if (currentPersona.group_primary) {
    visibleGroups.add(currentPersona.group_primary);
  }
  (currentPersona.groups_visible || []).forEach(g => visibleGroups.add(g));
  
  // See personas whose primary group matches our visible groups
  for (const p of allPersonas) {
    if (p.name === currentPersona.name) continue; // Don't see self
    if (p.name === "ei") continue; // Ei handled separately in prompts
    
    if (p.group_primary && visibleGroups.has(p.group_primary)) {
      visible.push(p);
    }
  }
  
  return visible;
}
```

## Integration

### System Prompt Updates
- Persona system prompts should list visible personas: "You know about these other personas: Gandalf, Frodo, Aragorn"
- Ei system prompt should list all personas (unchanged from current behavior if it exists)

### Persona List Display
- `/status` or persona list should show group info
- Consider showing groups in persona switcher

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Persona with no groups | Sees no other personas (except Ei in prompts) |
| Two personas, same group | See each other |
| Persona A in "Work", Persona B has `groups_visible: ["Work"]` | B sees A, A does NOT see B (unless A also has visibility to B's group) |
| All personas ungrouped | No cross-awareness (original isolated behavior) |

## Acceptance Criteria
- [x] Persona with `group_primary: "Work"` sees other personas with `group_primary: "Work"`
- [x] Persona with `groups_visible: ["Personal"]` sees personas in both "Work" (primary) and "Personal"
- [x] Persona with no groups (`group_primary: null`, `groups_visible: []`) sees no other personas
- [x] Ei sees all personas regardless of groups
- [x] Personas do NOT see themselves in their own context
- [x] System prompts list visible personas accurately
- [x] Visibility is NOT automatically symmetric (A seeing B doesn't mean B sees A)
- [x] `/status` command displays group membership for personas
- [x] Unit tests cover visibility scenarios:
  - Same group
  - Different groups
  - One-way visibility via `groups_visible`
  - No groups
  - Ei special case

## Dependencies
- 0095: Schema Changes - Group Fields

## Effort Estimate
Medium (~2-3 hours)
