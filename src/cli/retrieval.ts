import type { StorageState, Quote, Fact, Person, Topic } from "../core/types";
import type { PersonaEntity } from "../core/types/entities.js";
import type { PersonaTrait, PersonaTopic, PersonIdentifier } from "../core/types/data-items.js";
import { decodeAllEmbeddings } from "../storage/embeddings";
import { crossFind } from "../core/utils/index.ts";
import { join } from "path";
import { readFile } from "fs/promises";
import { getEmbeddingService, findTopK } from "../core/embedding-service";
import { parseMessageId } from "../core/utils/message-id.js";
import { getMachineId } from "../integrations/machine-id.js";
import { readCorrections, applyCorrectionsToState } from "../core/corrections.js";
import { getCorrectionsPath } from "./corrections-writer.js";
import { buildPersonaToolsMap } from "../core/persona-tools.js";

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
  let state: StorageState | null = null;
  for (const file of [STATE_FILE, BACKUP_FILE]) {
    try {
      const text = await readFile(join(dataPath, file), "utf-8");
      if (text) {
        state = decodeAllEmbeddings(JSON.parse(text) as StorageState);
        break;
      }
    } catch {
      continue;
    }
  }
  if (!state) return null;
  const corrections = await readCorrections(getCorrectionsPath());
  applyCorrectionsToState(state, corrections);
  return state;
}

export async function retrieve<T extends { id: string; embedding?: number[]; last_updated?: string; last_mentioned?: string }>(
  items: T[],
  query: string,
  limit: number = 10,
  options: { recent?: boolean } = {}
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }

  const { recent } = options;

  const sortByRecent = (a: T, b: T): number => {
    const aDate = a.last_mentioned ?? (a as Record<string, unknown>).last_updated as string ?? "";
    const bDate = b.last_mentioned ?? (b as Record<string, unknown>).last_updated as string ?? "";
    return bDate.localeCompare(aDate);
  };

  if (recent && !query) {
    return [...items].sort(sortByRecent).slice(0, limit);
  }

  if (!query) {
    return [];
  }

  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(query);

  if (recent) {
    const topK = Math.max(limit * 5, 50);
    const results = findTopK(queryVector, items, topK)
      .filter(({ similarity }) => similarity >= EMBEDDING_MIN_SIMILARITY)
      .map(({ item }) => item);
    return results.sort(sortByRecent).slice(0, limit);
  }

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
export interface LinkedQuote {
  id: string;
  text: string;
  speaker: string;
  timestamp: string;
}
export interface QuoteResult {
  text: string;
  speaker: string;
  timestamp: string;
  message_id: string | null;
  linked_items: LinkedItem[];
}

export interface FactResult {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  validated_date?: string;
  sources?: string[];
}

export interface PersonResult {
  id: string;
  name: string;
  description: string;
  relationship: string;
  sentiment: number;
  identifiers: PersonIdentifier[];
}

export interface TopicResult {
  id: string;
  name: string;
  description: string;
  category?: string;
  sentiment: number;
}

export interface PersonaResult {
  id: string;
  display_name: string;
  short_description?: string;
  model?: string;
  base_prompt: string;
  traits: PersonaTrait[];
  topics: PersonaTopic[];
}

export type BalancedResult =
  | ({ type: "quote" } & QuoteResult)
  | ({ type: "fact" } & FactResult)
  | ({ type: "person" } & PersonResult)
  | ({ type: "topic" } & TopicResult)
  | ({ type: "persona" } & PersonaResult);

const DATA_TYPES = ["quote", "fact", "person", "topic", "persona"] as const;
type DataType = typeof DATA_TYPES[number];

interface ScoredEntry {
  type: DataType;
  similarity: number;
  mapped: QuoteResult | FactResult | PersonResult | TopicResult | PersonaResult;
  itemId: string;
}

export function resolveLinkedItems(dataItemIds: string[], state: StorageState): LinkedItem[] {
  const items: LinkedItem[] = [];
  const collections: Array<{ type: string; source: Array<{ id: string; name: string }> }> = [
    { type: "topic", source: state.human.topics },
    { type: "person", source: state.human.people },
    { type: "fact", source: state.human.facts },
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
    text: quote.text,
    speaker: quote.speaker,
    timestamp: quote.timestamp,
    message_id: quote.message_id,
    linked_items: resolveLinkedItems(quote.data_item_ids, state),
  };
}

function mapFact(fact: Fact): FactResult {
  return {
    id: fact.id,
    name: fact.name,
    description: fact.description,
    sentiment: fact.sentiment,
    validated_date: fact.validated_date,
    sources: fact.sources,
  };
}


function mapPerson(person: Person): PersonResult {
  return {
    id: person.id,
    name: person.name,
    description: person.description,
    relationship: person.relationship,
    sentiment: person.sentiment,
    identifiers: person.identifiers ?? [],
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

export function mapPersona(persona: PersonaEntity): PersonaResult {
  return {
    id: persona.id,
    display_name: persona.display_name,
    short_description: persona.short_description,
    model: persona.model,
    base_prompt: persona.long_description ?? "",
    traits: persona.traits,
    topics: persona.topics,
  };
}

export function retrievePersonas(
  query: string,
  state: StorageState,
  limit: number = 10,
  options: { recent?: boolean } = {}
): PersonaResult[] {
  const { recent } = options;
  const personaList = Object.values(state.personas).map((p) => p.entity);

  if (recent && !query) {
    return personaList
      .sort((a, b) => b.last_updated.localeCompare(a.last_updated))
      .slice(0, limit)
      .map(mapPersona);
  }

  if (!query) {
    return [];
  }

  const q = query.toLowerCase();
  const nameMatches = personaList.filter((p) => p.display_name.toLowerCase().includes(q));
  if (nameMatches.length > 0) {
    return nameMatches
      .sort((a, b) => b.last_updated.localeCompare(a.last_updated))
      .slice(0, limit)
      .map(mapPersona);
  }

  return [];
}

export async function retrievePersonasSemantic(
  queryVector: number[],
  state: StorageState,
  limit: number = 10,
): Promise<PersonaResult[]> {
  const personaList = Object.values(state.personas).map((p) => p.entity);
  const withEmbeddings = personaList
    .filter((p): p is PersonaEntity & { description_embedding: number[] } => Array.isArray(p.description_embedding) && p.description_embedding.length > 0)
    .map((p) => ({ id: p.id, embedding: p.description_embedding, _entity: p }));

  if (withEmbeddings.length === 0) {
    return [];
  }

  const scored = findTopK(queryVector, withEmbeddings, withEmbeddings.length);
  return scored
    .filter(({ similarity }) => similarity >= EMBEDDING_MIN_SIMILARITY)
    .slice(0, limit)
    .map(({ item }) => mapPersona((item as typeof withEmbeddings[number])._entity));
}

export async function retrieveBalanced(
  query: string,
  limit: number = 10,
  options: { recent?: boolean } = {}
): Promise<BalancedResult[]> {
  const state = await loadLatestState();
  if (!state) {
    console.error("No saved state found. Is EI_DATA_PATH set correctly?");
    return [];
  }

  const { recent } = options;

  type AnyItem = { id: string; embedding?: number[]; last_updated?: string; last_mentioned?: string };
  const recentDate = (item: AnyItem): string => item.last_mentioned ?? item.last_updated ?? "";

  if (recent && !query) {
    const allItems: Array<{ type: DataType; item: AnyItem; mapped: QuoteResult | FactResult | PersonResult | TopicResult }> = [
      ...state.human.quotes.map(q => ({ type: "quote" as DataType, item: q as AnyItem, mapped: mapQuote(q, state) })),
      ...state.human.facts.map(f => ({ type: "fact" as DataType, item: f as AnyItem, mapped: mapFact(f) })),
      ...state.human.people.map(p => ({ type: "person" as DataType, item: p as AnyItem, mapped: mapPerson(p) })),
      ...state.human.topics.map(t => ({ type: "topic" as DataType, item: t as AnyItem, mapped: mapTopic(t) })),
    ];
    return allItems
      .sort((a, b) => recentDate(b.item).localeCompare(recentDate(a.item)))
      .slice(0, limit)
      .map(({ type, mapped }) => ({ type, ...mapped }) as BalancedResult);
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
    { type: "person", items: state.human.people, mapper: mapPerson },
    { type: "topic", items: state.human.topics, mapper: mapTopic },
  ];

  if (recent) {
    for (const { type, items, mapper } of typeConfigs) {
      const topK = Math.max(limit * 5, 50);
      const scored = findTopK(queryVector, items, topK);
      for (const { item, similarity } of scored) {
        if (similarity >= EMBEDDING_MIN_SIMILARITY) {
          allScored.push({ type, similarity, mapped: mapper(item), itemId: item.id });
        }
      }
    }
    return allScored
      .sort((a, b) => recentDate(b.mapped as AnyItem).localeCompare(recentDate(a.mapped as AnyItem)))
      .slice(0, limit)
      .map(({ type, mapped }) => ({ type, ...mapped }) as BalancedResult);
  }

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

const OPENCODE_MESSAGE_ID = /^msg_[a-zA-Z0-9]+$/;

/** @deprecated Use resolveExternalMessage */
export async function resolveOpenCodeMessage(
  id: string,
  before = 0,
  after = 0
): Promise<Record<string, unknown> | null> {
  return resolveExternalMessage(id, before, after);
}

export async function resolveExternalMessage(
  id: string,
  before = 0,
  after = 0
): Promise<Record<string, unknown> | null> {
  const parsed = parseMessageId(id);

  switch (parsed.integration) {
    case "ei": {
      const state = await loadLatestState();
      if (!state) return null;

      for (const { entity: persona, messages } of Object.values(state.personas)) {
        const idx = messages.findIndex(m => m.id === id);
        if (idx === -1) continue;
        const msg = messages[idx];
        return {
          type: "opencode_message",
          message: { id: msg.id, role: msg.role, content: msg.content ?? "", timestamp: msg.timestamp },
          before: messages.slice(Math.max(0, idx - before), idx).map(m => ({ id: m.id, role: m.role, content: m.content ?? "", timestamp: m.timestamp })),
          after: messages.slice(idx + 1, idx + 1 + after).map(m => ({ id: m.id, role: m.role, content: m.content ?? "", timestamp: m.timestamp })),
          session: { id: persona.id, title: persona.display_name, directory: "" },
          source: "ei",
        };
      }

      for (const room of Object.values(state.rooms ?? {})) {
        const idx = room.messages.findIndex(m => m.id === id);
        if (idx === -1) continue;
        const msg = room.messages[idx];
        return {
          type: "opencode_message",
          message: { id: msg.id, role: msg.role, content: msg.content ?? "", timestamp: msg.timestamp },
          before: room.messages.slice(Math.max(0, idx - before), idx).map(m => ({ id: m.id, role: m.role, content: m.content ?? "", timestamp: m.timestamp })),
          after: room.messages.slice(idx + 1, idx + 1 + after).map(m => ({ id: m.id, role: m.role, content: m.content ?? "", timestamp: m.timestamp })),
          session: { id: room.id, title: room.display_name, directory: "" },
          source: "ei",
        };
      }

      return null;
    }

    case "opencode": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      try {
        const { createOpenCodeReader } = await import("../integrations/opencode/reader-factory.js");
        const reader = await createOpenCodeReader();
        const win = await reader.getMessageById(parsed.nativeId, before, after);
        if (!win) return null;
        return {
          type: "opencode_message",
          message: { id: win.message.id, role: win.message.role, content: win.message.content, timestamp: win.message.timestamp, agent: win.message.agent },
          before: win.before.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agent: m.agent })),
          after: win.after.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agent: m.agent })),
          session: { id: win.session.id, title: win.session.title, directory: win.session.directory },
          source: "opencode",
        };
      } catch {
        return null;
      }
    }

    case "claudecode": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      try {
        const { ClaudeCodeReader } = await import("../integrations/claude-code/reader.js");
        const reader = new ClaudeCodeReader();
        const messages = await reader.getMessagesForSession(parsed.session!);
        const idx = messages.findIndex(m => m.id === parsed.nativeId);
        if (idx === -1) return null;
        const msg = messages[idx];
        return {
          type: "opencode_message",
          message: { id: msg.id, role: msg.role, content: msg.content, timestamp: msg.timestamp },
          before: messages.slice(Math.max(0, idx - before), idx).map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          after: messages.slice(idx + 1, idx + 1 + after).map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          session: { id: parsed.session!, title: parsed.session!, directory: "" },
          source: "claudecode",
        };
      } catch {
        return null;
      }
    }

    case "cursor": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      try {
        const { CursorReader } = await import("../integrations/cursor/reader.js");
        const reader = new CursorReader();
        const sessions = await reader.getSessions();
        const session = sessions.find(s => s.id === parsed.session);
        if (!session) return null;
        const idx = session.messages.findIndex(m => m.id === parsed.nativeId);
        if (idx === -1) return null;
        const msg = session.messages[idx];
        const mapCursor = (m: { id: string; type: 1 | 2; text: string; timestamp: string }) => ({
          id: m.id,
          role: (m.type === 1 ? "user" : "assistant") as "user" | "assistant",
          content: m.text,
          timestamp: m.timestamp,
        });
        return {
          type: "opencode_message",
          message: mapCursor(msg),
          before: session.messages.slice(Math.max(0, idx - before), idx).map(mapCursor),
          after: session.messages.slice(idx + 1, idx + 1 + after).map(mapCursor),
          session: { id: session.id, title: session.name, directory: session.workspacePath },
          source: "cursor",
        };
      } catch {
        return null;
      }
    }

    case "codex": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      try {
        const { CodexReader } = await import("../integrations/codex/reader.js");
        const reader = new CodexReader();
        const win = await reader.getMessageById(parsed.session!, parsed.nativeId, before, after);
        if (!win) return null;
        return {
          type: "opencode_message",
          message: { id: win.message.id, role: win.message.role, content: win.message.content, timestamp: win.message.timestamp },
          before: win.before.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          after: win.after.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          session: { id: win.session.id, title: win.session.title, directory: win.session.cwd },
          source: "codex",
        };
      } catch {
        return null;
      }
    }

    case "pi": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      try {
        const { PiReader } = await import("../integrations/pi/reader.js");
        const reader = new PiReader();
        const win = await reader.getMessageById(parsed.session!, parsed.nativeId, before, after);
        if (!win) return null;
        return {
          type: "opencode_message",
          message: { id: win.message.id, role: win.message.role, content: win.message.content, timestamp: win.message.timestamp },
          before: win.before.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          after: win.after.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          session: { id: win.session.id, title: win.session.title, directory: win.session.cwd },
          source: "pi",
        };
      } catch {
        return null;
      }
    }

    case "unknown":
    default: {
      // Backward compat: bare msg_xxx → treat as opencode (no machine qualifier)
      if (OPENCODE_MESSAGE_ID.test(id)) {
        try {
          const { createOpenCodeReader } = await import("../integrations/opencode/reader-factory.js");
          const reader = await createOpenCodeReader();
          const win = await reader.getMessageById(id, before, after);
          if (!win) return null;
          return {
            type: "opencode_message",
            message: { id: win.message.id, role: win.message.role, content: win.message.content, timestamp: win.message.timestamp, agent: win.message.agent },
            before: win.before.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agent: m.agent })),
            after: win.after.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agent: m.agent })),
            session: { id: win.session.id, title: win.session.title, directory: win.session.directory },
            source: "opencode",
          };
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

export async function lookupById(id: string): Promise<({ type: string } & Record<string, unknown>) | null> {
  const state = await loadLatestState();
  if (!state) {
    return null;
  }

  const personaEntities = Object.values(state.personas).map((p) => p.entity);
  const found = crossFind(id, state.human, personaEntities);
  if (!found) return null;
  const { type, ...rest } = found;
  const withoutEmbedding = { ...rest } as Record<string, unknown>;
  delete withoutEmbedding.embedding;
  delete withoutEmbedding.description_embedding;

  // data_item_ids on a Quote can only point at facts, topics, or people — the other
  // types crossFind can return (quote itself, and the persona-side persona/
  // personaTopic/personaTrait records) sit outside that linkage model entirely, so
  // they never get a linked_quotes field. For the three linkable types, surface
  // which quotes reference this entity: a human correcting a bad merge/split (e.g.
  // un-merging an over-merged Person) needs this blast radius before repointing
  // anything.
  if (type === "fact" || type === "topic" || type === "person") {
    withoutEmbedding.linked_quotes = state.human.quotes
      .filter((q) => q.data_item_ids.includes(id))
      .map((q) => ({ id: q.id, text: q.text, speaker: q.speaker, timestamp: q.timestamp }));
  }
  // A persisted PersonaEntity.tools is a flat array of ToolDefinition ids —
  // opaque to a caller who doesn't already know every tool's UUID. Enrich it
  // into the same self-documenting `{ providerDisplayName: { toolDisplayName:
  // boolean } }` map the TUI's $EDITOR/YAML persona editor uses, so an agent
  // reading a persona via `ei --id` can both see what's granted AND discover
  // what else is grantable (and under which — possibly disabled — provider)
  // without a separate lookup. buildPersonaToolsMap returns undefined when no
  // tools are registered at all; that undefined/absent result is preserved.
  if (type === "persona") {
    withoutEmbedding.tools = buildPersonaToolsMap(
      (withoutEmbedding.tools as string[] | undefined) ?? [],
      state.tools ?? [],
      state.providers ?? []
    );
  }
  return { type, ...withoutEmbedding };
}
