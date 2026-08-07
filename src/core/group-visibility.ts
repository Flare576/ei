import type { PersonaEntity, Quote } from "./types.js";

// =============================================================================
// SHARED PERSONA GROUP-VISIBILITY PREDICATE FOR QUOTES
// =============================================================================
//
// A quote isn't "interested" in a persona the way a Fact/Topic/Person is (via
// `interested_personas`) — it was said in a context, and that context's
// visibility is governed by `persona_groups` intersected against the target
// persona's group membership. This is the exact rule `filterHumanDataByVisibility`
// already applies for prompt-context building (`prompt-context-builder.ts`);
// every other surface that scopes quotes to a persona (CLI/MCP search,
// `find_memory`) MUST reuse this same predicate rather than reinvent one.

export const DEFAULT_GROUP = "General";

/** The set of groups a persona can see into: its own primary group plus any groups_visible. */
export function getPersonaVisibleGroups(
  persona: Pick<PersonaEntity, "group_primary" | "groups_visible"> | undefined | null
): Set<string> {
  const visibleGroups = new Set<string>();
  if (!persona) return visibleGroups;
  if (persona.group_primary) {
    visibleGroups.add(persona.group_primary);
  }
  (persona.groups_visible ?? []).forEach((g) => visibleGroups.add(g));
  return visibleGroups;
}

/** A quote with no groups defaults to DEFAULT_GROUP, same as every other DataItemBase. */
function isQuoteGroupVisible(quote: Pick<Quote, "persona_groups">, visibleGroups: Set<string>): boolean {
  const effectiveGroups = quote.persona_groups.length === 0 ? [DEFAULT_GROUP] : quote.persona_groups;
  return effectiveGroups.some((g) => visibleGroups.has(g));
}

/**
 * Filters quotes to only those the given persona can group-visibly see.
 * The "ei" meta-persona (the omniscient system guide) sees every quote,
 * matching `filterHumanDataByVisibility`'s `persona.id === "ei"` branch.
 * A `persona` that can't be resolved (undefined/null) has no visible groups,
 * so the result is an empty set of quotes — a filter that finds nothing is
 * correct behavior, not the same as excluding quotes from the surface entirely.
 */
export function filterQuotesByPersonaGroupVisibility<T extends Pick<Quote, "persona_groups">>(
  quotes: T[],
  persona: Pick<PersonaEntity, "id" | "group_primary" | "groups_visible"> | undefined | null
): T[] {
  if (persona?.id === "ei") return quotes;
  const visibleGroups = getPersonaVisibleGroups(persona);
  return quotes.filter((q) => isQuoteGroupVisible(q, visibleGroups));
}
