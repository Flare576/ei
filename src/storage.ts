import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { ConceptMap, ConversationHistory, Message } from "./types.js";

const DATA_DIR = new URL("../data/", import.meta.url);

function dataPath(filename: string): URL {
  return new URL(filename, DATA_DIR);
}

function personaPath(persona: string, filename: string): URL {
  return new URL(`personas/${persona}/${filename}`, DATA_DIR);
}

export async function loadConceptMap(
  entity: "human" | "system",
  persona?: string
): Promise<ConceptMap> {
  let path: URL;
  if (entity === "human") {
    path = dataPath("human.jsonc");
  } else {
    path = personaPath(persona || "ei", "system.jsonc");
  }
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as ConceptMap;
}

export async function saveConceptMap(
  map: ConceptMap,
  persona?: string
): Promise<void> {
  let path: URL;
  if (map.entity === "human") {
    path = dataPath("human.jsonc");
  } else {
    path = personaPath(persona || "ei", "system.jsonc");
  }
  map.last_updated = new Date().toISOString();
  await writeFile(path, JSON.stringify(map, null, 2), "utf-8");
}

export async function loadHistory(persona?: string): Promise<ConversationHistory> {
  const path = personaPath(persona || "ei", "history.jsonc");
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as ConversationHistory;
}

export async function saveHistory(
  history: ConversationHistory,
  persona?: string
): Promise<void> {
  const path = personaPath(persona || "ei", "history.jsonc");
  await writeFile(path, JSON.stringify(history, null, 2), "utf-8");
}

export async function appendMessage(
  message: Message,
  persona?: string
): Promise<void> {
  const history = await loadHistory(persona);
  history.messages.push(message);
  await saveHistory(history, persona);
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

export interface PersonaInfo {
  name: string;
  aliases: string[];
}

export async function listPersonas(): Promise<PersonaInfo[]> {
  const personasDir = new URL("personas/", DATA_DIR);
  const entries = await readdir(personasDir, { withFileTypes: true });
  
  const personas: PersonaInfo[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const systemPath = personaPath(entry.name, "system.jsonc");
        const content = await readFile(systemPath, "utf-8");
        const map = JSON.parse(content) as ConceptMap;
        personas.push({
          name: entry.name,
          aliases: map.aliases || [],
        });
      } catch {
        personas.push({ name: entry.name, aliases: [] });
      }
    }
  }
  
  return personas;
}

export async function findPersonaByNameOrAlias(
  nameOrAlias: string
): Promise<string | null> {
  const personas = await listPersonas();
  const lower = nameOrAlias.toLowerCase();
  
  for (const p of personas) {
    if (p.name.toLowerCase() === lower) return p.name;
    if (p.aliases.some(a => a.toLowerCase() === lower)) return p.name;
  }
  
  return null;
}

export function personaExists(persona: string): boolean {
  const dir = new URL(`personas/${persona}/`, DATA_DIR);
  return existsSync(dir);
}

export async function createPersonaDirectory(persona: string): Promise<void> {
  const dir = new URL(`personas/${persona}/`, DATA_DIR);
  await mkdir(dir, { recursive: true });
}
