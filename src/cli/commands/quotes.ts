import { loadLatestState, retrieve, mapQuote } from "../retrieval";
import type { QuoteResult } from "../retrieval";

export async function execute(query: string, limit: number): Promise<QuoteResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  const quotes = state.human.quotes;
  if (quotes.length === 0) {
    return [];
  }

  const results = await retrieve(quotes, query, limit);

  return results.map(quote => mapQuote(quote, state));
}
