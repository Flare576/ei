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
}
