import type { StorageState, Quote, Fact, Trait, Person, Topic } from "../core/types";
import { crossFind } from "../core/utils/index.ts";
import { join } from "path";
import { readFile } from "fs/promises";
import { getEmbeddingService, findTopK } from "../core/embedding-service";

const STATE_FILE = "state.json";
const BACKUP_FILE = "state.backup.json";
const EMBEDDING_MIN_SIMILARITY = 0.3;

export function getDataPath(): string {
  if (process.env.EI_DATA_PATH) {
    return process.env.EI_DATA_PATH;
  }
  const xdgData = process.env.XDG_DATA_HOME || join(process.env.HOME || "~", ".local", "share");
  return join(xdgData, "ei");
}

export async function loadLatestState(): Promise<StorageState | null> {
  const dataPath = getDataPath();
  for (const file of [STATE_FILE, BACKUP_FILE]) {
    try {
      const text = await readFile(join(dataPath, file), "utf-8");
      if (text) return JSON.parse(text) as StorageState;
    } catch {
      continue;
    }
  }
    return null;
}

export async function retrieve<T extends { id: string; embedding?: number[] }>(
  items: T[],
  query: string,
  limit: number = 10
): Promise<T[]> {
  if (items.length === 0 || !query) {
    return [];
  }

  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(query);

  const results = findTopK(queryVector, items, limit);

  return results
    .filter(({ similarity }) => similarity >= EMBEDDING_MIN_SIMILARITY)
    .map(({ item }) => item);
}

export interface LinkedItem {
  id: string;
  name: string;
  type: string;
}
export interface QuoteResult {
  id: string;
  text: string;
  speaker: string;
  timestamp: string;
  linked_items: LinkedItem[];
}

export interface FactResult {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  validated: string;
}

export interface TraitResult {
  id: string;
  name: string;
  description: string;
  strength: number;
  sentiment: number;
}

export interface PersonResult {
  id: string;
  name: string;
  description: string;
  relationship: string;
  sentiment: number;
}

export interface TopicResult {
  id: string;
  name: string;
  description: string;
  category?: string;
  sentiment: number;
}

export type BalancedResult =
  | ({ type: "quote" } & QuoteResult)
  | ({ type: "fact" } & FactResult)
  | ({ type: "trait" } & TraitResult)
  | ({ type: "person" } & PersonResult)
  | ({ type: "topic" } & TopicResult);

const DATA_TYPES = ["quote", "fact", "trait", "person", "topic"] as const;
type DataType = typeof DATA_TYPES[number];

interface ScoredEntry {
  type: DataType;
  similarity: number;
  mapped: QuoteResult | FactResult | TraitResult | PersonResult | TopicResult;
  itemId: string;
}

export function resolveLinkedItems(dataItemIds: string[], state: StorageState): LinkedItem[] {
  const items: LinkedItem[] = [];
  const collections: Array<{ type: string; source: Array<{ id: string; name: string }> }> = [
    { type: "topic", source: state.human.topics },
    { type: "person", source: state.human.people },
    { type: "fact", source: state.human.facts },
    { type: "trait", source: state.human.traits },
  ];
  for (const { type, source } of collections) {
    for (const entity of source) {
      if (dataItemIds.includes(entity.id)) {
        items.push({ id: entity.id, name: entity.name, type });
      }
    }
  }
  return items;
}
export function mapQuote(quote: Quote, state: StorageState): QuoteResult {
  return {
    id: quote.id,
    text: quote.text,
    speaker: quote.speaker,
    timestamp: quote.timestamp,
    linked_items: resolveLinkedItems(quote.data_item_ids, state),
  };
}

function mapFact(fact: Fact): FactResult {
  return {
    id: fact.id,
    name: fact.name,
    description: fact.description,
    sentiment: fact.sentiment,
    validated: fact.validated,
  };
}

function mapTrait(trait: Trait): TraitResult {
  return {
    id: trait.id,
    name: trait.name,
    description: trait.description,
    strength: trait.strength ?? 0.5,
    sentiment: trait.sentiment,
  };
}

function mapPerson(person: Person): PersonResult {
  return {
    id: person.id,
    name: person.name,
    description: person.description,
    relationship: person.relationship,
    sentiment: person.sentiment,
  };
}

function mapTopic(topic: Topic): TopicResult {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    category: topic.category,
    sentiment: topic.sentiment,
  };
}

export async function retrieveBalanced(
  query: string,
  limit: number = 10
): Promise<BalancedResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(query);

  const allScored: ScoredEntry[] = [];

  const typeConfigs: Array<{
    type: DataType;
    items: Array<{ id: string; embedding?: number[] }>;
    mapper: (item: any) => any;
  }> = [
    { type: "quote", items: state.human.quotes, mapper: (q: Quote) => mapQuote(q, state) },
    { type: "fact", items: state.human.facts, mapper: mapFact },
    { type: "trait", items: state.human.traits, mapper: mapTrait },
    { type: "person", items: state.human.people, mapper: mapPerson },
    { type: "topic", items: state.human.topics, mapper: mapTopic },
  ];

  for (const { type, items, mapper } of typeConfigs) {
    const scored = findTopK(queryVector, items, items.length);
    for (const { item, similarity } of scored) {
      if (similarity >= EMBEDDING_MIN_SIMILARITY) {
        allScored.push({ type, similarity, mapped: mapper(item), itemId: item.id });
      }
    }
  }

  const result: ScoredEntry[] = [];
  const used = new Set<string>();

  // Floor: at least 1 result per type (if available and meets threshold)
  for (const type of DATA_TYPES) {
    if (result.length >= limit) break;
    const best = allScored
      .filter(r => r.type === type && !used.has(r.itemId))
      .sort((a, b) => b.similarity - a.similarity)[0];
    if (best) {
      result.push(best);
      used.add(best.itemId);
    }
  }

  // Fill remaining slots with highest-similarity results across all types
  const remaining = allScored
    .filter(r => !used.has(r.itemId))
    .sort((a, b) => b.similarity - a.similarity);

  for (const entry of remaining) {
    if (result.length >= limit) break;
    result.push(entry);
    used.add(entry.itemId);
  }

  result.sort((a, b) => b.similarity - a.similarity);

  return result.map(({ type, mapped }) => ({ type, ...mapped }) as BalancedResult);
}

export async function lookupById(id: string): Promise<({ type: string } & Record<string, unknown>) | null> {
  const state = await loadLatestState();
  if (!state) {
    return null;
  }

  const found = crossFind(id, state.human);
  if (!found) return null;
  const { type, embedding, ...rest } = found;
  return { type, ...rest };
}
