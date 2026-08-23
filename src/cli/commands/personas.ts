import { loadLatestState, retrievePersonas, retrievePersonasSemantic, mapPersona } from "../retrieval";
import { getEmbeddingService } from "../../core/embedding-service";
import { partitionTraits, bucketTraits } from "../../prompts/trait-utils";
import type { PersonaResult } from "../retrieval";

// Mirrors response/sections.ts's TRAIT_BUCKETS (kept as its own copy, same
// pattern room/sections.ts already follows, rather than a cross-cutting
// export change out of scope for this fix). Deliberately uncapped: GH #99 —
// a persona's traits exist for a reason, and this block is small enough
// that budgeting them out was never the point of the >= 0.7 filter it
// replaces.
const RELATIONSHIP_TRAIT_BUCKETS = [
  { min: 90, max: 100, header: "### Core Expression\nThese define you. They should be evident in every response." },
  { min: 66, max: 89,  header: "### Strong Tendencies\nFrequent and traceable, but not in every sentence." },
  { min: 36, max: 65,  header: "### Noticeable in Casual Messages\nPresent but not dominating — surfaces naturally, not constantly." },
  { min: 1,  max: 35,  header: "### Subtle Undercurrents\nBackground texture only. Use sparingly or subtly." },
] as const;

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
  const { guardrails, active } = partitionTraits(persona.traits ?? []);
  const sortedActive = [...active].sort((a, b) => (b.strength ?? 0.5) - (a.strength ?? 0.5));

  const traitSections: string[] = [];
  if (guardrails.length > 0) {
    const lines = guardrails.map((t) => `**${t.name}**`).join("\n");
    traitSections.push(`### Must NEVER Do — User Explicitly Asked You To Stop\n${lines}`);
  }
  for (const { bucket, traits: inBucket } of bucketTraits(sortedActive, RELATIONSHIP_TRAIT_BUCKETS)) {
    if (inBucket.length === 0) continue;
    const lines = inBucket.map((t) => `**${t.name}**: ${t.description}`).join("\n");
    traitSections.push(`${bucket.header}\n${lines}`);
  }
  const traitsBlock = traitSections.length > 0 ? traitSections.join("\n\n") : "(no traits recorded)";

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
    "## Working Style",
    "",
    traitsBlock,
    "",
    "### Shared Context",
    sortedTopics || "(no topics)",
    ...signalSection,
    "</ei-relationship>",
  ].join("\n");
}
