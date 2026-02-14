import { loadLatestState, retrieve } from "../retrieval";
import type { FactResult } from "../retrieval";

export async function execute(snippets: string[], limit: number): Promise<FactResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }
  
  const facts = state.human.facts;
  if (facts.length === 0) {
    return [];
  }
  
  const results = await retrieve(facts, snippets, limit);
  
  return results.map(fact => ({
    id: fact.id,
    name: fact.name,
    description: fact.description,
    sentiment: fact.sentiment,
    validated: fact.validated,
  }));
}
