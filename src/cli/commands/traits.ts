import { loadLatestState, retrieve } from "../retrieval";
import type { TraitResult } from "../retrieval";

export async function execute(query: string, limit: number): Promise<TraitResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  const traits = state.human.traits;
  if (traits.length === 0) {
    return [];
  }

  const results = await retrieve(traits, query, limit);
  
  return results.map(trait => ({
    id: trait.id,
    name: trait.name,
    description: trait.description,
    strength: trait.strength ?? 0.5,
    sentiment: trait.sentiment,
  }));
}
