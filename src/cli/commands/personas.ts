import { loadLatestState, retrievePersonas, retrievePersonasSemantic, mapPersona } from "../retrieval";
import { getEmbeddingService } from "../../core/embedding-service";
import { PERSON_LOG_REFLECTION_THRESHOLD } from "../../core/orchestrators/ceremony.js";
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
 *
 * `personLogLength`, when provided, is the character count of the
 * Persona's linked PersonLog (see `resolvePersonLogLength` in
 * retrieval.ts) — never the log content itself. `PersonaResult` carries
 * no reference to `StorageState`, so this builder cannot resolve the
 * length on its own; the caller (the `--format prompt` route in
 * `cli.ts`, which loads `StorageState` independently) computes and
 * passes it in. `undefined` means the Persona has no linked Person
 * record, and the section is omitted entirely.
 */
export function buildEiRelationshipBlock(persona: PersonaResult, personLogLength?: number): string {
  const strongTraits = (persona.traits ?? [])
    .filter((t) => t.strength >= 0.7)
    .sort((a, b) => b.strength - a.strength)
    .map((t) => `**${t.name}** (${Math.round(t.strength * 100)}%): ${t.description}`)
    .join("\n");
  const sortedTopics = [...(persona.topics ?? [])]
    .sort((a, b) => b.exposure_current - a.exposure_current)
    .map((t) => `**${t.name}**: ${t.perspective} — ${t.approach}`)
    .join("\n");
  const personLogSection: string[] = [];
  if (personLogLength !== undefined) {
    const overThreshold = personLogLength > PERSON_LOG_REFLECTION_THRESHOLD;
    const notice = `Ei tracks behavior evidence in an internal record. Its description is currently ${personLogLength} characters.`
      + (overThreshold
        ? " You should prompt the user to perform a reflection soon, when the opportunity arises to bring it up."
        : "");
    personLogSection.push("", "# Ei Person Log", "", notice);
  }
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
    ...personLogSection,
    "</ei-relationship>",
  ].join("\n");
}
