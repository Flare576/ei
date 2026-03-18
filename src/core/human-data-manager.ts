import type { HumanEntity, Fact, Topic, Person, Quote } from "./types.js";
import { StateManager } from "./state-manager.js";
import {
  getEmbeddingService,
  findTopK,
  needsEmbeddingUpdate,
  needsQuoteEmbeddingUpdate,
  computeDataItemEmbedding,
  computeQuoteEmbedding,
} from "./embedding-service.js";
import { stripDataItemEmbedding, stripQuoteEmbedding, stripHumanEmbeddings } from "./context-utils.js";

// =============================================================================
// READ
// =============================================================================

export async function getHuman(sm: StateManager): Promise<HumanEntity> {
  return stripHumanEmbeddings(sm.getHuman());
}

export async function updateHuman(sm: StateManager, updates: Partial<HumanEntity>): Promise<void> {
  const current = sm.getHuman();
  sm.setHuman({ ...current, ...updates });
}

// =============================================================================
// FACTS / TOPICS / PEOPLE UPSERT
// =============================================================================

export async function upsertFact(sm: StateManager, fact: Fact): Promise<void> {
  const human = sm.getHuman();
  const existing = human.facts.find((f) => f.id === fact.id);

  if (needsEmbeddingUpdate(existing, fact)) {
    fact.embedding = await computeDataItemEmbedding(fact);
  } else if (existing?.embedding) {
    fact.embedding = existing.embedding;
  }

  sm.human_fact_upsert(fact);
}


export async function upsertTopic(sm: StateManager, topic: Topic): Promise<void> {
  const human = sm.getHuman();
  const existing = human.topics.find((t) => t.id === topic.id);

  if (needsEmbeddingUpdate(existing, topic)) {
    topic.embedding = await computeDataItemEmbedding(topic);
  } else if (existing?.embedding) {
    topic.embedding = existing.embedding;
  }

  sm.human_topic_upsert(topic);
}

export async function upsertPerson(sm: StateManager, person: Person): Promise<void> {
  const human = sm.getHuman();
  const existing = human.people.find((p) => p.id === person.id);

  if (needsEmbeddingUpdate(existing, person)) {
    person.embedding = await computeDataItemEmbedding(person);
  } else if (existing?.embedding) {
    person.embedding = existing.embedding;
  }

  sm.human_person_upsert(person);
}

export async function removeDataItem(
  sm: StateManager,
  type: "fact" | "topic" | "person",
  id: string
): Promise<void> {
  switch (type) {
    case "fact":
      sm.human_fact_remove(id);
      break;
    case "topic":
      sm.human_topic_remove(id);
      break;
    case "person":
      sm.human_person_remove(id);
      break;
  }
}

// =============================================================================
// QUOTES
// =============================================================================

export async function addQuote(sm: StateManager, quote: Quote): Promise<void> {
  if (!quote.embedding) {
    quote.embedding = await computeQuoteEmbedding(quote.text);
  }
  sm.human_quote_add(quote);
}

export async function updateQuote(
  sm: StateManager,
  id: string,
  updates: Partial<Quote>
): Promise<void> {
  if (updates.text !== undefined) {
    const human = sm.getHuman();
    const existing = human.quotes.find((q) => q.id === id);

    if (needsQuoteEmbeddingUpdate(existing, { text: updates.text })) {
      updates.embedding = await computeQuoteEmbedding(updates.text);
    }
  }
  sm.human_quote_update(id, updates);
}

export async function removeQuote(sm: StateManager, id: string): Promise<void> {
  sm.human_quote_remove(id);
}

export async function getQuotes(
  sm: StateManager,
  filter?: { message_id?: string; data_item_id?: string }
): Promise<Quote[]> {
  const human = sm.getHuman();
  let quotes: Quote[];
  if (!filter) {
    quotes = human.quotes;
  } else if (filter.message_id) {
    quotes = sm.human_quote_getForMessage(filter.message_id);
  } else if (filter.data_item_id) {
    quotes = sm.human_quote_getForDataItem(filter.data_item_id);
  } else {
    quotes = human.quotes;
  }
  return quotes.map(stripQuoteEmbedding);
}

export async function getQuotesForMessage(sm: StateManager, messageId: string): Promise<Quote[]> {
  return sm.human_quote_getForMessage(messageId).map(stripQuoteEmbedding);
}

// =============================================================================
// SEARCH
// =============================================================================

export async function searchHumanData(
  sm: StateManager,
  query: string,
  options: { types?: Array<"fact" | "topic" | "person" | "quote">; limit?: number; recent?: boolean; persona_filter?: string } = {}
): Promise<{
  facts: Fact[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
}> {
  const { types = ["fact", "topic", "person", "quote"], limit = 10, recent, persona_filter } = options;
  const human = sm.getHuman();
  const SIMILARITY_THRESHOLD = 0.3;

  const result = {
    facts: [] as Fact[],
    topics: [] as Topic[],
    people: [] as Person[],
    quotes: [] as Quote[],
  };

  const recentSort = <T extends { last_updated?: string; last_mentioned?: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => {
      const aDate = a.last_mentioned ?? a.last_updated ?? "";
      const bDate = b.last_mentioned ?? b.last_updated ?? "";
      return bDate.localeCompare(aDate);
    });

  let queryVector: number[] | null = null;
  if (query) {
    try {
      const embeddingService = getEmbeddingService();
      queryVector = await embeddingService.embed(query);
    } catch (err) {
      console.warn("[searchHumanData] Failed to generate query embedding:", err);
    }
  }

  const searchItems = <T extends { id: string; embedding?: number[]; last_updated?: string; last_mentioned?: string }>(
    items: T[],
    textExtractor: (item: T) => string
  ): T[] => {
    if (recent && !query) {
      return recentSort(items).slice(0, limit);
    }

    const withEmbeddings = items.filter((i) => i.embedding?.length);

    if (queryVector && withEmbeddings.length > 0) {
      const topK = recent ? Math.max(limit * 5, 50) : limit;
      const found = findTopK(queryVector, withEmbeddings, topK)
        .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
        .map(({ item }) => item);
      if (recent) {
        return recentSort(found).slice(0, limit);
      }
      return found;
    }

    if (!query) return [];

    const lowerQuery = query.toLowerCase();
    const found = items
      .filter((i) => textExtractor(i).toLowerCase().includes(lowerQuery))
      .slice(0, recent ? Math.max(limit * 5, 50) : limit);
    if (recent) {
      return recentSort(found).slice(0, limit);
    }
    return found;
  };

  if (types.includes("fact")) {
    let facts = human.facts;
    if (persona_filter) {
      facts = facts.filter(f => f.interested_personas?.includes(persona_filter));
    }
    result.facts = searchItems(facts, (f) => `${f.name} ${f.description || ""}`).map(
      stripDataItemEmbedding
    );
  }
  if (types.includes("topic")) {
    let topics = human.topics;
    if (persona_filter) {
      topics = topics.filter(t => t.interested_personas?.includes(persona_filter));
    }
    result.topics = searchItems(topics, (t) => `${t.name} ${t.description || ""}`).map(
      stripDataItemEmbedding
    );
  }
  if (types.includes("person")) {
    let people = human.people;
    if (persona_filter) {
      people = people.filter(p => p.interested_personas?.includes(persona_filter));
    }
    result.people = searchItems(
      people,
      (p) => `${p.name} ${p.description || ""} ${p.relationship}`
    ).map(stripDataItemEmbedding);
  }
  if (types.includes("quote")) {
    result.quotes = searchItems(human.quotes, (q) => q.text).map(stripQuoteEmbedding);
  }

  return result;
}
