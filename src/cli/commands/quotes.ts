import { loadLatestState, retrieve } from "../retrieval";
import type { QuoteResult } from "../retrieval";

export async function execute(snippets: string[], limit: number): Promise<QuoteResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }
  
  const quotes = state.human.quotes;
  if (quotes.length === 0) {
    return [];
  }
  
  const results = await retrieve(quotes, snippets, limit);
  
  return results.map(quote => {
    const linkedTopics = state.human.topics
      .filter(t => quote.data_item_ids.includes(t.id))
      .map(t => t.name);
    
    const linkedPeople = state.human.people
      .filter(p => quote.data_item_ids.includes(p.id))
      .map(p => p.name);
    
    return {
      id: quote.id,
      text: quote.text,
      speaker: quote.speaker,
      timestamp: quote.timestamp,
      linked_topics: [...linkedTopics, ...linkedPeople],
    };
  });
}
