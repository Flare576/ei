import { Concept, ConceptMap } from "./types.js";

export const GLOBAL_GROUP = "*";

function isGlobalConcept(personaGroups: string[] | undefined): boolean {
  return personaGroups?.includes(GLOBAL_GROUP) ?? false;
}

export function reconcileConceptGroups(
  existingConcepts: Concept[],
  llmUpdatedConcepts: Concept[],
  persona: ConceptMap,
  personaName: string
): Concept[] {
  const now = new Date().toISOString();
  const personaGroup = persona.group_primary;
  const reconciled: Concept[] = [];

  for (const updated of llmUpdatedConcepts) {
    const existing = existingConcepts.find((c) => c.name === updated.name);

    if (existing) {
      let personaGroups: string[];
      
      if (isGlobalConcept(existing.persona_groups)) {
        personaGroups = [GLOBAL_GROUP];
      } else {
        const groups = new Set(existing.persona_groups || []);
        if (personaGroup) {
          groups.add(personaGroup);
        }
        personaGroups = Array.from(groups);
      }

      reconciled.push({
        ...updated,
        persona_groups: personaGroups,
        learned_by: existing.learned_by,
        last_updated: now,
      });
    } else {
      reconciled.push({
        ...updated,
        persona_groups: personaGroup ? [personaGroup] : [GLOBAL_GROUP],
        learned_by: personaName,
        last_updated: now,
      });
    }
  }

  return reconciled;
}
