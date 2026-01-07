import { readFile, writeFile } from "fs/promises";
import { ConceptMap, ConversationHistory, Message } from "./types.js";

const DATA_DIR = new URL("../data/", import.meta.url);

function dataPath(filename: string): URL {
  return new URL(filename, DATA_DIR);
}

export async function loadConceptMap(
  entity: "human" | "system"
): Promise<ConceptMap> {
  const path = dataPath(`${entity}.jsonc`);
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as ConceptMap;
}

export async function saveConceptMap(map: ConceptMap): Promise<void> {
  const path = dataPath(`${map.entity}.jsonc`);
  map.last_updated = new Date().toISOString();
  await writeFile(path, JSON.stringify(map, null, 2), "utf-8");
}

export async function loadHistory(): Promise<ConversationHistory> {
  const path = dataPath("history.jsonc");
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as ConversationHistory;
}

export async function saveHistory(history: ConversationHistory): Promise<void> {
  const path = dataPath("history.jsonc");
  await writeFile(path, JSON.stringify(history, null, 2), "utf-8");
}

export async function appendMessage(message: Message): Promise<void> {
  const history = await loadHistory();
  history.messages.push(message);
  await saveHistory(history);
}

export function getRecentMessages(
  history: ConversationHistory,
  maxHours: number = 8,
  maxMessages: number = 100
): Message[] {
  const cutoff = Date.now() - maxHours * 60 * 60 * 1000;

  const recent = history.messages
    .filter((m) => new Date(m.timestamp).getTime() > cutoff)
    .slice(-maxMessages);

  return recent;
}

export function getLastMessageTime(history: ConversationHistory): number {
  if (history.messages.length === 0) return 0;
  const last = history.messages[history.messages.length - 1];
  return new Date(last.timestamp).getTime();
}
