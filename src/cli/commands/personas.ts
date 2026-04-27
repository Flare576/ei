import { loadLatestState, retrievePersonas, retrievePersonasSemantic } from "../retrieval";
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

  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(query);
  const semanticResults = await retrievePersonasSemantic(queryVector, state, limit);
  return semanticResults;
}
