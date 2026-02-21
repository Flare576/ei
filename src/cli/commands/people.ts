import { loadLatestState, retrieve } from "../retrieval";
import type { PersonResult } from "../retrieval";

export async function execute(query: string, limit: number): Promise<PersonResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  const people = state.human.people;
  if (people.length === 0) {
    return [];
  }

  const results = await retrieve(people, query, limit);
  
  return results.map(person => ({
    id: person.id,
    name: person.name,
    description: person.description,
    relationship: person.relationship,
    sentiment: person.sentiment,
  }));
}
