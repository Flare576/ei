import { loadLatestState, retrievePersonas } from "../retrieval";
import type { PersonaResult } from "../retrieval";

export async function execute(query: string, limit: number, options: { recent?: boolean } = {}): Promise<PersonaResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  return retrievePersonas(query, state, limit, options);
}
