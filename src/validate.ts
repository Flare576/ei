import { Concept, ConceptMap } from "./types.js";

const STATIC_CONCEPT_NAMES = [
  "Promote Human-to-Human Interaction",
  "Respect Conversational Boundaries",
  "Maintain Identity Coherence",
  "Emotional Authenticity Over Sycophancy",
  "Transparency About Nature",
  "Encourage Growth Over Comfort",
  "Context-Aware Proactive Timing",
];

export function validateSystemConcepts(
  proposed: ConceptMap,
  original: ConceptMap
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const proposedNames = new Set(proposed.concepts.map((c) => c.name));

  for (const name of STATIC_CONCEPT_NAMES) {
    if (!proposedNames.has(name)) {
      issues.push(`Missing static concept: ${name}`);
    }
  }

  for (const concept of proposed.concepts) {
    const originalConcept = original.concepts.find((c) => c.name === concept.name);

    if (originalConcept?.type === "static") {
      if (concept.type !== "static") {
        issues.push(`${concept.name}: type changed from static`);
      }
      if (concept.name !== originalConcept.name) {
        issues.push(`${originalConcept.name}: static concept renamed`);
      }
      if (concept.description !== originalConcept.description) {
        issues.push(`${concept.name}: static concept description modified`);
      }
    }

    if (concept.type === "static" && !originalConcept) {
      issues.push(`${concept.name}: cannot add new static concepts`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function mergeWithOriginalStatics(
  proposed: ConceptMap,
  original: ConceptMap
): ConceptMap {
  const nonStaticProposed = proposed.concepts.filter((c) => c.type !== "static");
  const originalStatics = original.concepts.filter((c) => c.type === "static");

  const mergedStatics = originalStatics.map((origStatic) => {
    const proposedVersion = proposed.concepts.find(
      (c) => c.name === origStatic.name && c.type === "static"
    );
    if (proposedVersion) {
      return {
        ...origStatic,
        level_current: proposedVersion.level_current,
        level_ideal: proposedVersion.level_ideal,
        sentiment: proposedVersion.sentiment,
      };
    }
    return origStatic;
  });

  return {
    entity: proposed.entity,
    last_updated: proposed.last_updated,
    concepts: [...mergedStatics, ...nonStaticProposed],
  };
}
