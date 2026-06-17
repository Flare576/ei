import { loadLatestState, retrievePersonas, retrievePersonasSemantic, mapPersona } from "../retrieval";
import { getEmbeddingService } from "../../core/embedding-service";
import type { PersonaResult } from "../retrieval";

export async function execute(query: string, limit: number, options: { recent?: boolean } = {}): Promise<PersonaResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  const nameResults = retrievePersonas(query, state, limit, options);
  if (nameResults.length > 0 || !query || options.recent) {
    return nameResults;
  }

  // BUG-2 fix: query may be longer than the stored persona name
  // (e.g. "Beta — QA Goddess" vs stored "Beta"). Try reverse containment
  // before falling to semantic search, which requires an embedding.
  const queryLower = query.toLowerCase();
  const reverseResults = Object.values(state.personas)
    .map((p) => p.entity)
    .filter((p) => queryLower.includes(p.display_name.toLowerCase()))
    .slice(0, limit)
    .map(mapPersona);
  if (reverseResults.length > 0) {
    return reverseResults;
  }

  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(query);
  const semanticResults = await retrievePersonasSemantic(queryVector, state, limit);
  return semanticResults;
}

/**
 * Format a PersonaResult as a <ei-relationship> block for injection into
 * AI system prompts. Equivalent to the jq formatter in .zshenv.omp and
 * the inline builder previously in the OpenCode plugin — consolidated here
 * so all integrations can call `ei personas <name> --format prompt`.
 */
export function buildEiRelationshipBlock(persona: PersonaResult): string {
  const strongTraits = (persona.traits ?? [])
    .filter((t) => t.strength >= 0.7)
    .sort((a, b) => b.strength - a.strength)
    .map((t) => `**${t.name}** (${Math.round(t.strength * 100)}%): ${t.description}`)
    .join("\n");
  const sortedTopics = [...(persona.topics ?? [])]
    .sort((a, b) => b.exposure_current - a.exposure_current)
    .map((t) => `**${t.name}**: ${t.perspective} — ${t.approach}`)
    .join("\n");
  return [
    "<!-- ei-relationship-injected -->",
    "<ei-relationship>",
    "## Ei: Relationship Context",
    "",
    persona.base_prompt ?? "",
    "",
    "### Working Style",
    strongTraits || "(no traits above threshold)",
    "",
    "### Shared Context",
    sortedTopics || "(no topics)",
    "</ei-relationship>",
  ].join("\n");
}
