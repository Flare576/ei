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
 *
 * `hasActiveSignals`, when true, means this Persona has at least one
 * `candidate`/`recurring` emergent signal in either lens (see
 * `resolvePersonaHasActiveSignals` in retrieval.ts) — the section then
 * invites the agent to ask about them, never naming or describing a
 * single one. `PersonaResult` carries no reference to `StorageState`, so
 * this builder cannot resolve signal presence on its own; the caller (the
 * `--format prompt` route in `cli.ts`, which loads `StorageState`
 * independently) computes and passes it in. `false` or `undefined` omits
 * the section entirely — there is nothing to invite the agent to ask
 * about (Bolt 007, D1; replaces the character-count PersonLog readiness
 * cue this builder previously emitted here).
 */
export function buildEiRelationshipBlock(persona: PersonaResult, hasActiveSignals?: boolean): string {
  const strongTraits = (persona.traits ?? [])
    .filter((t) => (t.strength ?? 0.5) >= 0.7)
    .sort((a, b) => (b.strength ?? 0.5) - (a.strength ?? 0.5))
    .map((t) => `**${t.name}** (${Math.round((t.strength ?? 0.5) * 100)}%): ${t.description}`)
    .join("\n");
  const sortedTopics = [...(persona.topics ?? [])]
    .sort((a, b) => b.exposure_current - a.exposure_current)
    .map((t) => `**${t.name}**: ${t.perspective} — ${t.approach}`)
    .join("\n");
  const signalSection: string[] = [];
  if (hasActiveSignals) {
    signalSection.push(
      "",
      "# Ei Signals",
      "",
      "Ei has noticed potential behavior signals for this Persona. Ask if you'd like to know more — Ei won't volunteer their content unprompted."
    );
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
    ...signalSection,
    "</ei-relationship>",
  ].join("\n");
}
