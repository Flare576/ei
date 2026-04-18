import type { StorageState } from "../core/types.js";
import type { BalancedResult } from "./retrieval.js";

export function resolvePersonaId(state: StorageState, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const { entity } of Object.values(state.personas)) {
    if (entity.display_name.toLowerCase() === lowerName) {
      return entity.id;
    }
  }
  return null;
}

export function filterByPersona(results: BalancedResult[], state: StorageState, personaId: string): BalancedResult[] {
  return results.filter((result) => {
    if (result.type === "quote") {
      return false;
    }
    const { id } = result;
    let original: { interested_personas?: string[] } | undefined;
    if (result.type === "fact") {
      original = state.human.facts.find((f) => f.id === id);
    } else if (result.type === "topic") {
      original = state.human.topics.find((t) => t.id === id);
    } else if (result.type === "person") {
      original = state.human.people.find((p) => p.id === id);
    }
    return original?.interested_personas?.includes(personaId) ?? false;
  });
}

export function filterTypeSpecificByPersona<T extends { id: string }>(
  results: T[],
  state: StorageState,
  personaId: string,
  targetType: string
): T[] {
  if (targetType === "quotes") {
    return [];
  }
  const collection =
    targetType === "facts"
      ? state.human.facts
      : targetType === "topics"
        ? state.human.topics
        : targetType === "people"
          ? state.human.people
          : null;
  if (!collection) return results;
  return results.filter((r) => {
    const original = collection.find((item) => item.id === r.id) as { interested_personas?: string[] } | undefined;
    return original?.interested_personas?.includes(personaId) ?? false;
  });
}

export function filterBySource(results: BalancedResult[], state: StorageState, sourcePrefix: string): BalancedResult[] {
  return results.filter((result) => {
    if (result.type === "quote") {
      return false;
    }
    const { id } = result;
    let original: { sources?: string[] } | undefined;
    if (result.type === "fact") {
      original = state.human.facts.find((f) => f.id === id);
    } else if (result.type === "topic") {
      original = state.human.topics.find((t) => t.id === id);
    } else if (result.type === "person") {
      original = state.human.people.find((p) => p.id === id);
    }
    return original?.sources?.some((s) => s.startsWith(sourcePrefix)) ?? false;
  });
}

export function filterTypeSpecificBySource<T extends { id: string }>(
  results: T[],
  state: StorageState,
  sourcePrefix: string,
  targetType: string
): T[] {
  if (targetType === "quotes") {
    return [];
  }
  const collection =
    targetType === "facts"
      ? state.human.facts
      : targetType === "topics"
        ? state.human.topics
        : targetType === "people"
          ? state.human.people
          : null;
  if (!collection) return results;
  return results.filter((r) => {
    const original = collection.find((item) => item.id === r.id) as { sources?: string[] } | undefined;
    return original?.sources?.some((s) => s.startsWith(sourcePrefix)) ?? false;
  });
}
