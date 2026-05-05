import type { Fact, Topic, Person, Quote } from "../../core/types.js";

export interface EnrichedTopic {
  topic: Topic;
  quotes: Quote[];
}

export interface EnrichedPerson {
  person: Person;
  quotes: Quote[];
}

export interface SynthesisPromptData {
  subject: string;
  facts: Fact[];
  topics: EnrichedTopic[];
  people: EnrichedPerson[];
  standaloneQuotes: Quote[];
  /**
   * Map of entity ID → display name for all entities included in this payload.
   * Used to annotate quote links: IDs present in a quote's data_item_ids but
   * absent from this map are rendered as "(not loaded)" — a signal to the LLM
   * that a related record exists and can be fetched via fetch_memory.
   */
  loadedEntityNames?: Map<string, string>;
}
