import { loadLatestState, retrieve } from "../retrieval";
import type { TopicResult } from "../retrieval";

export async function execute(snippets: string[], limit: number): Promise<TopicResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }
  
  const topics = state.human.topics;
  if (topics.length === 0) {
    return [];
  }
  
  const results = await retrieve(topics, snippets, limit);
  
  return results.map(topic => ({
    id: topic.id,
    name: topic.name,
    description: topic.description,
    category: topic.category,
    sentiment: topic.sentiment,
  }));
}
