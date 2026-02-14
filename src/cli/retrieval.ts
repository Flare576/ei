import type { StorageState } from "../core/types";
import { join } from "path";
import { getEmbeddingService, findTopK } from "../core/embedding-service";

const AUTO_SAVES_FILE = "autosaves.json";
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
  const filePath = join(dataPath, AUTO_SAVES_FILE);
  
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    
    const text = await file.text();
    if (!text) return null;
    
    const autoSaves = JSON.parse(text) as StorageState[];
    if (autoSaves.length === 0) return null;
    
    return autoSaves[autoSaves.length - 1];
  } catch {
    return null;
  }
}

export async function retrieve<T extends { id: string; embedding?: number[] }>(
  items: T[],
  snippets: string[],
  limit: number = 10
): Promise<T[]> {
  if (items.length === 0 || snippets.length === 0) {
    return [];
  }

  const queryText = snippets.join(" ");
  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(queryText);

  const results = findTopK(queryVector, items, limit);
  
  return results
    .filter(({ similarity }) => similarity >= EMBEDDING_MIN_SIMILARITY)
    .map(({ item }) => item);
}

export interface QuoteResult {
  id: string;
  text: string;
  speaker: string;
  timestamp: string;
  linked_topics: string[];
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
