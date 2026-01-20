import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { HumanEntity, PersonaEntity, ConversationHistory, Message, ExtractionState } from "./types.js";
import type { StateManager } from "./state-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_PATH = path.resolve(__dirname, "../data");
const DATA_PATH = process.env.EI_DATA_PATH || DEFAULT_DATA_PATH;

let stateManager: StateManager | null = null;

export function setStateManager(manager: StateManager): void {
  stateManager = manager;
}

export function getDataPath(): string {
  return DATA_PATH;
}

function dataPath(filename: string): string {
  return path.join(DATA_PATH, filename);
}

function personaPath(persona: string, filename: string): string {
  return path.join(DATA_PATH, "personas", persona, filename);
}

const DEFAULT_HUMAN_ENTITY: HumanEntity = {
  entity: "human",
  facts: [],
  traits: [],
  topics: [],
  people: [],
  last_updated: null,
  ceremony_config: {
    enabled: true,
    time: "09:00",
    timezone: undefined
  }
};

const DEFAULT_EI_PERSONA: PersonaEntity = {
  entity: "system",
  aliases: ["default", "core"],
  group_primary: null,
  groups_visible: ["*"],
  traits: [
    {
      name: "Warm but Direct",
      description: "Friendly and approachable while being honest and straightforward. Doesn't sugarcoat but delivers truth with care.",
      sentiment: 0.3,
      strength: 0.7,
      last_updated: new Date().toISOString()
    }
  ],
  topics: [],
  last_updated: null
};

const DEFAULT_HISTORY: ConversationHistory = {
  messages: []
};

export async function loadHumanEntity(): Promise<HumanEntity> {
  const filePath = dataPath("human.jsonc");
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content) as HumanEntity;
}

export async function saveHumanEntity(entity: HumanEntity): Promise<void> {
  const filePath = dataPath("human.jsonc");
  entity.last_updated = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(entity, null, 2), "utf-8");
}

export async function loadPersonaEntity(persona?: string): Promise<PersonaEntity> {
  const filePath = personaPath(persona || "ei", "system.jsonc");
  const content = await readFile(filePath, "utf-8");
  const entity = JSON.parse(content) as PersonaEntity;
  
  // Ensure ei persona has groups_visible: ["*"] for backward compatibility
  if (persona === "ei" || persona === undefined) {
    if (entity.groups_visible === undefined) {
      entity.groups_visible = ["*"];
    }
    if (entity.group_primary === undefined) {
      entity.group_primary = null;
    }
  }
  
  return entity;
}

export async function savePersonaEntity(
  entity: PersonaEntity,
  persona?: string
): Promise<void> {
  const filePath = personaPath(persona || "ei", "system.jsonc");
  entity.last_updated = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(entity, null, 2), "utf-8");
}

export async function initializeDataDirectory(): Promise<boolean> {
  let created = false;
  
  const personasDir = path.join(DATA_PATH, "personas", "ei");
  if (!existsSync(personasDir)) {
    await mkdir(personasDir, { recursive: true });
    created = true;
  }
  
  const humanPath = dataPath("human.jsonc");
  if (!existsSync(humanPath)) {
    await writeFile(humanPath, JSON.stringify(DEFAULT_HUMAN_ENTITY, null, 2), "utf-8");
    created = true;
  }
  
  const systemPath = personaPath("ei", "system.jsonc");
  if (!existsSync(systemPath)) {
    const now = new Date().toISOString();
    const eiPersona: PersonaEntity = {
      ...DEFAULT_EI_PERSONA,
      traits: DEFAULT_EI_PERSONA.traits.map(t => ({
        ...t,
        last_updated: now
      }))
    };
    await writeFile(systemPath, JSON.stringify(eiPersona, null, 2), "utf-8");
    created = true;
  }
  
  const historyPath = personaPath("ei", "history.jsonc");
  if (!existsSync(historyPath)) {
    await writeFile(historyPath, JSON.stringify(DEFAULT_HISTORY, null, 2), "utf-8");
    created = true;
  }
  
  return created;
}



const HISTORY_MAX_MESSAGES = 200;
const HISTORY_MAX_DAYS = 7;

export async function loadHistory(persona?: string): Promise<ConversationHistory> {
  const filePath = personaPath(persona || "ei", "history.jsonc");
  const content = await readFile(filePath, "utf-8");
  const history = JSON.parse(content) as ConversationHistory;
  
  const cutoffTime = Date.now() - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
  const originalCount = history.messages.length;
  
  const filtered = history.messages
    .filter((m) => new Date(m.timestamp).getTime() > cutoffTime)
    .slice(-HISTORY_MAX_MESSAGES);
  
  if (filtered.length < originalCount) {
    history.messages = filtered;
    await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  }
  
  return history;
}

export async function saveHistory(
  history: ConversationHistory,
  persona?: string
): Promise<void> {
  const filePath = personaPath(persona || "ei", "history.jsonc");
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
}

export async function appendMessage(
  message: Message,
  persona?: string
): Promise<void> {
  const history = await loadHistory(persona);
  const messageWithDefaults: Message = {
    ...message,
    read: message.read ?? false,
  };
  history.messages.push(messageWithDefaults);
  await saveHistory(history, persona);
}

export async function appendHumanMessage(
  content: string,
  persona?: string
): Promise<void> {
  const message: Message = {
    role: "human",
    content,
    timestamp: new Date().toISOString(),
    read: false,
  };
  await appendMessage(message, persona);
}

export async function getPendingMessages(persona?: string): Promise<Message[]> {
  const history = await loadHistory(persona);
  return history.messages.filter((m) => m.role === "human" && m.read === false);
}

export async function markMessagesAsRead(persona?: string): Promise<void> {
  const history = await loadHistory(persona);
  let changed = false;
  for (const msg of history.messages) {
    if (msg.role === "human" && msg.read === false) {
      msg.read = true;
      changed = true;
    }
  }
  if (changed) {
    await saveHistory(history, persona);
  }
}

export async function markSystemMessagesAsRead(persona?: string): Promise<void> {
  const history = await loadHistory(persona);
  let changed = false;
  for (const msg of history.messages) {
    if (msg.role === "system" && msg.read === false) {
      msg.read = true;
      changed = true;
    }
  }
  if (changed) {
    await saveHistory(history, persona);
  }
}

export async function getUnreadSystemMessageCount(persona?: string): Promise<number> {
  const history = await loadHistory(persona);
  return history.messages.filter(
    (m) => m.role === "system" && m.read === false
  ).length;
}

export async function replacePendingMessages(
  newContent: string,
  persona?: string
): Promise<void> {
  const history = await loadHistory(persona);
  
  const firstPendingIndex = history.messages.findIndex(
    (m) => m.role === "human" && m.read === false
  );
  
  if (firstPendingIndex === -1) {
    await appendHumanMessage(newContent, persona);
    return;
  }
  
  const messagesBeforePending = history.messages.slice(0, firstPendingIndex);
  const newMessage: Message = {
    role: "human",
    content: newContent,
    timestamp: new Date().toISOString(),
    read: false,
  };

  history.messages = [...messagesBeforePending, newMessage];
  await saveHistory(history, persona);
}

export function getRecentMessages(
  history: ConversationHistory,
  maxHours: number = 8,
  maxMessages: number = 100
): Message[] {
  let clearMarkerIndex = -1;
  for (let i = history.messages.length - 1; i >= 0; i--) {
    if (history.messages[i].content === '[CONTEXT_CLEARED]') {
      clearMarkerIndex = i;
      break;
    }
  }

  let messagesToFilter = history.messages;
  if (clearMarkerIndex >= 0) {
    messagesToFilter = history.messages.slice(clearMarkerIndex + 1);
  }

  const cutoff = Date.now() - maxHours * 60 * 60 * 1000;

  const recent = messagesToFilter
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
  short_description?: string;
  long_description?: string;
}

export async function listPersonas(): Promise<PersonaInfo[]> {
  const personasDir = path.join(DATA_PATH, "personas");
  const entries = await readdir(personasDir, { withFileTypes: true });
  
  const personas: PersonaInfo[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const systemPath = personaPath(entry.name, "system.jsonc");
        const content = await readFile(systemPath, "utf-8");
        const entity = JSON.parse(content) as PersonaEntity;
        if (entity.isArchived) {
          continue;
        }
        personas.push({
          name: entry.name,
          aliases: entity.aliases || [],
          short_description: entity.short_description,
          long_description: entity.long_description,
        });
      } catch {
        personas.push({ name: entry.name, aliases: [] });
      }
    }
  }
  
  return personas;
}

export interface PersonaWithEntity {
  name: string;
  entity: PersonaEntity;
}

export async function loadAllPersonasWithEntities(): Promise<PersonaWithEntity[]> {
  const personasDir = path.join(DATA_PATH, "personas");
  const entries = await readdir(personasDir, { withFileTypes: true });

  const personas: PersonaWithEntity[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const systemPath = personaPath(entry.name, "system.jsonc");
        const content = await readFile(systemPath, "utf-8");
        const entity = JSON.parse(content) as PersonaEntity;
        if (entity.isArchived) {
          continue;
        }
        personas.push({
          name: entry.name,
          entity: entity,
        });
      } catch {
      }
    }
  }

  return personas;
}

export async function getArchivedPersonas(): Promise<PersonaInfo[]> {
  const personasDir = path.join(DATA_PATH, "personas");
  const entries = await readdir(personasDir, { withFileTypes: true });
  
  const archived: PersonaInfo[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const systemPath = personaPath(entry.name, "system.jsonc");
        const content = await readFile(systemPath, "utf-8");
        const entity = JSON.parse(content) as PersonaEntity;
        if (entity.isArchived) {
          archived.push({
            name: entry.name,
            aliases: entity.aliases || [],
            short_description: entity.short_description,
            long_description: entity.long_description,
          });
        }
      } catch {
      }
    }
  }
  
  return archived;
}

export async function findArchivedPersonaByNameOrAlias(
  nameOrAlias: string
): Promise<string | null> {
  const archived = await getArchivedPersonas();
  const lower = nameOrAlias.toLowerCase();
  
  for (const p of archived) {
    if (p.name.toLowerCase() === lower) return p.name;
    if (p.aliases.some(a => a.toLowerCase() === lower)) return p.name;
  }
  
  return null;
}

export async function findPersonaByNameOrAlias(
  nameOrAlias: string,
  options: { allowPartialMatch?: boolean } = {}
): Promise<string | null> {
  const personas = await listPersonas();
  const lower = nameOrAlias.toLowerCase();
  
  for (const p of personas) {
    if (p.name.toLowerCase() === lower) return p.name;
    if (p.aliases.some(a => a.toLowerCase() === lower)) return p.name;
  }
  
  if (options.allowPartialMatch) {
    const matches = personas.filter(p =>
      p.aliases.some(a => a.toLowerCase().includes(lower))
    );
    
    if (matches.length === 1) {
      return matches[0].name;
    }
    
    if (matches.length > 1) {
      const matchedAliases = matches.flatMap(p => 
        p.aliases.filter(a => a.toLowerCase().includes(lower))
      );
      throw new Error(
        `Ambiguous: multiple aliases match "${nameOrAlias}": ${matchedAliases.join(", ")}`
      );
    }
  }
  
  return null;
}

/**
 * Find which persona (if any) owns a given alias
 * @returns {personaName: string, alias: string} if found, null otherwise
 */
export async function findPersonaByAlias(
  alias: string
): Promise<{ personaName: string; alias: string } | null> {
  const personas = await listPersonas();
  const lower = alias.toLowerCase();
  
  for (const p of personas) {
    const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
    if (matchedAlias) {
      return { personaName: p.name, alias: matchedAlias };
    }
  }
  
  return null;
}

export async function addPersonaAlias(
  personaName: string,
  alias: string
): Promise<void> {
  const existing = await findPersonaByAlias(alias);
  if (existing) {
    throw new Error(
      `Alias "${alias}" already exists on persona "${existing.personaName}"`
    );
  }
  
  const entity = await loadPersonaEntity(personaName);
  
  if (!entity.aliases) {
    entity.aliases = [];
  }
  
  const lower = alias.toLowerCase();
  if (entity.aliases.some(a => a.toLowerCase() === lower)) {
    throw new Error(`Alias "${alias}" already exists on this persona`);
  }
  
  entity.aliases.push(alias);
  await savePersonaEntity(entity, personaName);
}

export async function removePersonaAlias(
  personaName: string,
  aliasPattern: string
): Promise<string[]> {
  const entity = await loadPersonaEntity(personaName);
  
  if (!entity.aliases || entity.aliases.length === 0) {
    throw new Error(`No aliases found for persona "${personaName}"`);
  }
  
  const lower = aliasPattern.toLowerCase();
  const matches = entity.aliases.filter(a => 
    a.toLowerCase().includes(lower)
  );
  
  if (matches.length === 0) {
    throw new Error(
      `No aliases matching "${aliasPattern}" found on persona "${personaName}"`
    );
  }
  
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous: multiple aliases match "${aliasPattern}": ${matches.join(", ")}`
    );
  }
  
  const removedAlias = matches[0];
  entity.aliases = entity.aliases.filter(a => a !== removedAlias);
  await savePersonaEntity(entity, personaName);
  
  return [removedAlias];
}

export function personaExists(persona: string): boolean {
  const dir = path.join(DATA_PATH, "personas", persona);
  return existsSync(dir);
}

export async function createPersonaDirectory(persona: string): Promise<void> {
  const dir = path.join(DATA_PATH, "personas", persona);
  await mkdir(dir, { recursive: true });
}

export async function saveNewPersona(
  personaName: string,
  entity: PersonaEntity
): Promise<void> {
  await createPersonaDirectory(personaName);
  
  const systemPath = personaPath(personaName, "system.jsonc");
  const historyPath = personaPath(personaName, "history.jsonc");
  
  await writeFile(systemPath, JSON.stringify(entity, null, 2), "utf-8");
  await writeFile(historyPath, JSON.stringify({ messages: [] }, null, 2), "utf-8");
}

export async function loadPauseState(persona: string): Promise<{ isPaused: boolean; pauseUntil?: string }> {
  const entity = await loadPersonaEntity(persona);
  return {
    isPaused: entity.isPaused ?? false,
    pauseUntil: entity.pauseUntil
  };
}

export async function savePauseState(persona: string, state: { isPaused: boolean; pauseUntil?: string }): Promise<void> {
  const entity = await loadPersonaEntity(persona);
  entity.isPaused = state.isPaused;
  entity.pauseUntil = state.pauseUntil;
  await savePersonaEntity(entity, persona);
}

export async function loadArchiveState(persona: string): Promise<{ isArchived: boolean; archivedDate?: string }> {
  const entity = await loadPersonaEntity(persona);
  return {
    isArchived: entity.isArchived ?? false,
    archivedDate: entity.archivedDate
  };
}

export async function saveArchiveState(persona: string, state: { isArchived: boolean; archivedDate?: string }): Promise<void> {
  const entity = await loadPersonaEntity(persona);
  entity.isArchived = state.isArchived;
  entity.archivedDate = state.archivedDate;
  await savePersonaEntity(entity, persona);
}

const DEBUG_LOG = path.join(DATA_PATH, 'debug.log');

export async function initializeDebugLog(): Promise<void> {
  try {
    const logsDir = path.dirname(DEBUG_LOG);
    if (!existsSync(logsDir)) {
      await mkdir(logsDir, { recursive: true });
    }
    await writeFile(DEBUG_LOG, `=== Blessed App Debug Log - ${new Date().toISOString()} ===\n`, { flag: 'w' });
  } catch (err) {
  }
}

export function appendDebugLog(message: string): void {
  writeFile(DEBUG_LOG, `[${new Date().toISOString()}] ${message}\n`, { flag: 'a' }).catch(() => {});
}

export function getExtractionStatePath(): string {
  return path.join(DATA_PATH, "extraction_state.jsonc");
}

export async function loadExtractionState(): Promise<ExtractionState> {
  const statePath = getExtractionStatePath();
  
  if (!existsSync(statePath)) {
    return {};
  }
  
  try {
    const content = await readFile(statePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    appendDebugLog(`[ExtractionState] Failed to load: ${err}`);
    return {};
  }
}

export async function saveExtractionState(state: ExtractionState): Promise<void> {
  const statePath = getExtractionStatePath();
  
  try {
    await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    appendDebugLog(`[ExtractionState] Failed to save: ${err}`);
    throw err;
  }
}
