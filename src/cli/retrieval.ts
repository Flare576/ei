import type { StorageState, Quote, Fact, Person, Topic, Message, RoomMessage } from "../core/types";
import type { PersonaEntity } from "../core/types/entities.js";
import type { PersonaTrait, PersonaTopic, PersonIdentifier } from "../core/types/data-items.js";
import { decodeAllEmbeddings } from "../storage/embeddings";
import { crossFind } from "../core/utils/index.ts";
import { join } from "path";
import { readFile } from "fs/promises";
import { getEmbeddingService, findTopK } from "../core/embedding-service";
import { parseMessageId, qualifyOpenCodeMessage, qualifyClaudeCodeMessage, qualifyCursorMessage, qualifyCodexMessage, qualifyPiMessage } from "../core/utils/message-id.js";
import { getMachineId } from "../integrations/machine-id.js";
import { readCorrections, applyCorrectionsToState } from "../core/corrections.js";
import type { QuoteCorrectionSkip } from "../core/corrections.js";
import { getCorrectionsPath } from "./corrections-writer.js";
import { buildPersonaToolsMap } from "../core/persona-tools.js";
import type { OpenCodeMessage } from "../integrations/opencode/types.js";
import type { ClaudeCodeMessage } from "../integrations/claude-code/types.js";
import { CLAUDE_CODE_PERSONA_NAME } from "../integrations/claude-code/types.js";
import type { CursorMessage } from "../integrations/cursor/types.js";
import { CURSOR_PERSONA_NAME } from "../integrations/cursor/types.js";
import type { CodexMessage } from "../integrations/codex/types.js";
import { CODEX_PERSONA_NAME } from "../integrations/codex/types.js";
import type { PiMessage } from "../integrations/pi/types.js";
import { PI_PERSONA_NAME } from "../integrations/pi/types.js";

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

// Populated only by loadLatestState() (see getLastCorrectionSkips below),
// for the quote corrections it declined to materialize into the returned
// state. loadLatestState()'s own return type stays `StorageState | null`
// (a broad, pre-existing set of callers — CLI, correction endpoints, MCP,
// persona corrections, retrieval commands, and their tests — all keep
// receiving that exact primary return); this companion is the additive
// diagnostic surface instead of a breaking signature change.
let lastCorrectionSkips: QuoteCorrectionSkip[] = [];

/** The quote corrections the most recent loadLatestState() call declined to materialize (skipped for wrong shape, forbidden key, marker misuse, or a stale relink target), each as `{record_id, reason}`. Call immediately after loadLatestState() — see the Corrections Wire Grammar's "Skip/report diagnostic shape." */
export function getLastCorrectionSkips(): QuoteCorrectionSkip[] {
  return lastCorrectionSkips;
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
  if (!state) {
    lastCorrectionSkips = [];
    return null;
  }
  const corrections = await readCorrections(getCorrectionsPath());
  lastCorrectionSkips = applyCorrectionsToState(state, corrections);
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
  id: string;
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
    id: quote.id,
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

/**
 * Resolve the size of a Persona's linked PersonLog (the Person record(s)
 * whose `description` accumulates behavioral observations — see
 * `queueReflectionPhase` in ceremony.ts, which this mirrors).
 *
 * A Persona may be linked to more than one Person record. Readiness is
 * "any linked record over threshold," so this returns the length of the
 * LARGEST linked record rather than the first match: since any
 * over-threshold record is by definition larger than every under-threshold
 * one, the max is always the over-threshold record when exactly one
 * exists, and it is the most urgent one to surface when several do.
 *
 * Returns `undefined` when the Persona has no linked Person record at all
 * — callers use this to omit the notice entirely. Never returns or
 * exposes any PersonLog content, only its length.
 */
export function resolvePersonLogLength(personaId: string, state: StorageState): number | undefined {
  const linkedRecords = state.human.people.filter((p) =>
    p.identifiers?.some((i) => i.type.toLowerCase() === "ei persona" && i.value === personaId)
  );
  if (linkedRecords.length === 0) {
    return undefined;
  }
  return Math.max(...linkedRecords.map((p) => p.description?.length ?? 0));
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
): Promise<ResolvedMessage | { error: string } | ResolverRefusal | null> {
  return resolveExternalMessage(id, before, after);
}

/**
 * origin_kind discriminant for a ResolvedMessage. "ei-direct" and "ei-room"
 * both parse from the same `ei:<uuid>` id form (MessageIdIntegration only
 * has a single "ei" value) — which one applies is decided at resolve time
 * by which storage loop (persona thread vs room) actually contains the
 * message, not by the id's own shape. This is what closes B11: a
 * room-human message is no longer indistinguishable from a direct-human
 * message.
 */
export type ResolvedMessageOriginKind =
  | "ei-direct"
  | "ei-room"
  | "opencode"
  | "claudecode"
  | "cursor"
  | "codex"
  | "pi";

export interface ResolvedMessageContainer {
  /** "persona" = a direct 1:1 thread, "room" = a multi-participant room, "session" = an external coding-tool session. */
  kind: "persona" | "room" | "session";
  id: string;
  display_name: string;
}

export interface ResolvedMessageSpeaker {
  kind: "human" | "agent";
  /**
   * Stable identifier for the speaker, populated only where one exists: a
   * persona id (ei-direct/ei-room, including a dangling id when the
   * PersonaEntity was deleted), or an OpenCode/Pi per-message agent slug.
   * Absent for every "human" role and for external roles with no stable
   * per-message identity (Claude Code, Cursor, and Codex each speak
   * through one fixed integration-wide name).
   */
  id?: string;
  display_name: string;
}

/**
 * The discriminated resolver contract for a single resolved message,
 * replacing the old generic `{ type: "opencode_message", message, session,
 * source }` envelope. Every accepted origin populates every field below;
 * sources that cannot (Slack, document import/generation, a room message
 * whose role is "persona" with no persona_id at all) are explicitly
 * refused — resolveExternalMessage returns a discriminable
 * `ResolverRefusal` (`{ refused: true, reason }`) rather than fabricating
 * a partial result. Bare `null` is reserved for an id shape the resolver
 * does not recognize at all; callers may fall back to a legacy lookup
 * only on `null`, never on a refusal.
 */
export interface ResolvedMessage {
  origin_kind: ResolvedMessageOriginKind;
  /**
   * Canonical, fully-qualified locator for this exact message — stable
   * and re-resolvable even when the caller's original id was a legacy
   * bare/unqualified form.
   */
  source_id: string;
  container: ResolvedMessageContainer;
  speaker: ResolvedMessageSpeaker;
  timestamp: string;
  content: string;
  /**
   * Preceding messages in the same container, oldest-first, each itself a
   * ResolvedMessage with empty before/after (context windows do not nest).
   */
  before: ResolvedMessage[];
  /** Following messages in the same container, oldest-first, each itself a ResolvedMessage with empty before/after. */
  after: ResolvedMessage[];
}

/**
 * A resolver refusal: the id was a recognized/classifiable shape (Slack,
 * document import/generation, or a malformed room-message record), but
 * that source is explicitly not attestable/resolvable — distinct from
 * bare `null`, which means the id's shape was not recognized at all and
 * the caller may fall back to a legacy lookup. A refusal is terminal:
 * every public fetch surface (MCP's ei_fetch_message, the builtin
 * fetch_message tool executor) must report it, never fall through to a
 * legacy envelope.
 */
export interface ResolverRefusal {
  refused: true;
  reason: string;
}

const HUMAN_SPEAKER: ResolvedMessageSpeaker = { kind: "human", display_name: "Human" };

/**
 * Resolves a room message's speaker, applying the same orphaned-persona
 * "Participant" display fallback as handlers/utils.ts's
 * normalizeRoomMessages (replicated here, at fetch-message.ts, and at
 * mcp.ts so every read surface treats a deleted persona identically).
 * Returns null only when role is "persona" and persona_id is entirely
 * absent — a malformed record this adapter refuses to fabricate an
 * identity for. That is distinct from an orphaned persona_id (present,
 * but the PersonaEntity was deleted), which still resolves — just with
 * the "Participant" display fallback — because the id itself is real.
 */
function resolveRoomSpeaker(
  m: RoomMessage,
  personas: StorageState["personas"]
): ResolvedMessageSpeaker | null {
  if (m.role === "human") return HUMAN_SPEAKER;
  if (!m.persona_id) return null;
  const display_name = personas[m.persona_id]?.entity.display_name ?? "Participant";
  return { kind: "agent", id: m.persona_id, display_name };
}

/** Shared user/assistant → human/agent mapping for the 5 external integrations. */
function externalSpeaker(
  role: "user" | "assistant",
  agentId: string | undefined,
  agentDisplayName: string
): ResolvedMessageSpeaker {
  if (role === "user") return HUMAN_SPEAKER;
  return { kind: "agent", id: agentId, display_name: agentDisplayName };
}

/**
 * Shared by the explicit "opencode" case and the bare-`msg_xxx` legacy
 * fallback below — both resolve through the same reader and produce the
 * same shape, differing only in how the native message id was obtained.
 */
async function resolveOpenCode(nativeId: string, before: number, after: number): Promise<ResolvedMessage | null> {
  try {
    const { createOpenCodeReader } = await import("../integrations/opencode/reader-factory.js");
    const reader = await createOpenCodeReader();
    const win = await reader.getMessageById(nativeId, before, after);
    if (!win) return null;

    const container: ResolvedMessageContainer = { kind: "session", id: win.session.id, display_name: win.session.title };
    const toOpenCode = (m: OpenCodeMessage): ResolvedMessage => ({
      origin_kind: "opencode",
      source_id: qualifyOpenCodeMessage(getMachineId(), win.session.id, m.id),
      container,
      speaker: externalSpeaker(m.role, m.agent, m.agent),
      timestamp: m.timestamp,
      content: m.content,
      before: [],
      after: [],
    });

    return {
      ...toOpenCode(win.message),
      before: win.before.map(toOpenCode),
      after: win.after.map(toOpenCode),
    };
  } catch {
    return null;
  }
}

export async function resolveExternalMessage(
  id: string,
  before = 0,
  after = 0
): Promise<ResolvedMessage | { error: string } | ResolverRefusal | null> {
  const parsed = parseMessageId(id);

  switch (parsed.integration) {
    case "ei": {
      const state = await loadLatestState();
      if (!state) return null;

      for (const { entity: persona, messages } of Object.values(state.personas)) {
        const idx = messages.findIndex(m => m.id === id);
        if (idx === -1) continue;

        const container: ResolvedMessageContainer = { kind: "persona", id: persona.id, display_name: persona.display_name };
        const toDirect = (m: Message): ResolvedMessage => ({
          origin_kind: "ei-direct",
          source_id: m.id,
          container,
          speaker: m.role === "human" ? HUMAN_SPEAKER : { kind: "agent", id: persona.id, display_name: persona.display_name },
          timestamp: m.timestamp,
          content: m.content ?? "",
          before: [],
          after: [],
        });

        return {
          ...toDirect(messages[idx]),
          before: messages.slice(Math.max(0, idx - before), idx).map(toDirect),
          after: messages.slice(idx + 1, idx + 1 + after).map(toDirect),
        };
      }

      for (const room of Object.values(state.rooms ?? {})) {
        const idx = room.messages.findIndex(m => m.id === id);
        if (idx === -1) continue;

        const container: ResolvedMessageContainer = { kind: "room", id: room.id, display_name: room.display_name };
        const toRoom = (m: RoomMessage): ResolvedMessage | null => {
          const speaker = resolveRoomSpeaker(m, state.personas);
          if (!speaker) return null;
          return {
            origin_kind: "ei-room",
            source_id: m.id,
            container,
            speaker,
            timestamp: m.timestamp,
            content: m.content ?? "",
            before: [],
            after: [],
          };
        };

        const resolved = toRoom(room.messages[idx]);
        if (!resolved) {
          return {
            refused: true,
            reason: `Room message has role "persona" but no persona_id; cannot resolve a speaker identity for this record.`,
          };
        }

        const isResolved = (x: ResolvedMessage | null): x is ResolvedMessage => x !== null;
        resolved.before = room.messages.slice(Math.max(0, idx - before), idx).map(toRoom).filter(isResolved);
        resolved.after = room.messages.slice(idx + 1, idx + 1 + after).map(toRoom).filter(isResolved);
        return resolved;
      }

      return null;
    }

    case "opencode": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      return resolveOpenCode(parsed.nativeId, before, after);
    }

    case "claudecode": {
      if (parsed.machine !== getMachineId()) {
        return { error: `Message is from machine '${parsed.machine}', not available on this machine (${getMachineId()})` };
      }
      try {
        const { ClaudeCodeReader } = await import("../integrations/claude-code/reader.js");
        const reader = new ClaudeCodeReader();
        const messages = await reader.getMessagesForSession(parsed.session!);
        // C1: also require the record's OWN sessionId to match the
        // requested session -- defense in depth alongside the reader's
        // own traversal guard (getMessagesForSession). Real Claude Code
        // transcripts always satisfy this (a session's own records carry
        // that session's id), so no legitimate lookup is affected.
        const idx = messages.findIndex(m => m.id === parsed.nativeId && m.sessionId === parsed.session);
        if (idx === -1) return null;

        const container: ResolvedMessageContainer = { kind: "session", id: parsed.session!, display_name: parsed.session! };
        const toClaudeCode = (m: ClaudeCodeMessage): ResolvedMessage => ({
          origin_kind: "claudecode",
          source_id: qualifyClaudeCodeMessage(parsed.machine!, parsed.session!, m.id),
          container,
          speaker: externalSpeaker(m.role, undefined, CLAUDE_CODE_PERSONA_NAME),
          timestamp: m.timestamp,
          content: m.content,
          before: [],
          after: [],
        });

        return {
          ...toClaudeCode(messages[idx]),
          before: messages.slice(Math.max(0, idx - before), idx).map(toClaudeCode),
          after: messages.slice(idx + 1, idx + 1 + after).map(toClaudeCode),
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

        const container: ResolvedMessageContainer = { kind: "session", id: session.id, display_name: session.name };
        const toCursor = (m: CursorMessage): ResolvedMessage => ({
          origin_kind: "cursor",
          source_id: qualifyCursorMessage(parsed.machine!, session.id, m.id),
          container,
          speaker: externalSpeaker(m.type === 1 ? "user" : "assistant", undefined, CURSOR_PERSONA_NAME),
          timestamp: m.timestamp,
          content: m.text,
          before: [],
          after: [],
        });

        return {
          ...toCursor(session.messages[idx]),
          before: session.messages.slice(Math.max(0, idx - before), idx).map(toCursor),
          after: session.messages.slice(idx + 1, idx + 1 + after).map(toCursor),
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

        const container: ResolvedMessageContainer = { kind: "session", id: win.session.id, display_name: win.session.title };
        const toCodex = (m: CodexMessage): ResolvedMessage => ({
          origin_kind: "codex",
          source_id: qualifyCodexMessage(parsed.machine!, win.session.id, m.id),
          container,
          speaker: externalSpeaker(m.role, undefined, CODEX_PERSONA_NAME),
          timestamp: m.timestamp,
          content: m.content,
          before: [],
          after: [],
        });

        return {
          ...toCodex(win.message),
          before: win.before.map(toCodex),
          after: win.after.map(toCodex),
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

        const container: ResolvedMessageContainer = { kind: "session", id: win.session.id, display_name: win.session.title };
        const toPi = (m: PiMessage): ResolvedMessage => ({
          origin_kind: "pi",
          source_id: qualifyPiMessage(parsed.machine!, win.session.id, m.id),
          container,
          speaker: externalSpeaker(m.role, m.agent, m.agent ?? PI_PERSONA_NAME),
          timestamp: m.timestamp,
          content: m.content,
          before: [],
          after: [],
        });

        return {
          ...toPi(win.message),
          before: win.before.map(toPi),
          after: win.after.map(toPi),
        };
      } catch {
        return null;
      }
    }

    case "slack": {
      return {
        refused: true,
        reason: `Message originates from a Slack import; Slack sources are not independently resolvable/attestable.`,
      };
    }

    case "import": {
      return {
        refused: true,
        reason: `Message originates from an imported document; document sources are not independently resolvable/attestable.`,
      };
    }

    case "unknown":
    default: {
      // Backward compat: bare msg_xxx → treat as opencode (no machine qualifier)
      if (OPENCODE_MESSAGE_ID.test(id)) {
        return resolveOpenCode(id, before, after);
      }
      // Explicit refusal: generated documents use a literal `generate:document:`
      // id that predates the qualified-id scheme, so parseMessageId cannot
      // classify it via ParsedMessageId.integration — recognized here by
      // prefix instead, same as the OpenCode legacy check above.
      if (id.startsWith("generate:document:")) {
        return {
          refused: true,
          reason: `Message originates from a generated document; document sources are not independently resolvable/attestable.`,
        };
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

// Reverse lookup for the `Person.identifiers[]` array: mirrors
// StateManager#human_person_getByIdentifier's exact matching semantics
// (case-insensitive `type`, exact `value`; `type` is a user-extensible
// string like "Ei Persona" or "GitHub", not an enum) so a caller who only
// has a (type, value) pair — e.g. a Persona record's linked human identity —
// can resolve straight to the same enriched shape `lookupById` returns.
// Like the StateManager method it mirrors, this returns the FIRST matching
// Person and does not change that first-match behavior — safe for identifier
// types that are unique by construction (e.g. "Ei Persona"), but arbitrary if
// more than one Person shares a value under a type that isn't guaranteed
// unique (e.g. "Nickname", "First Name"). Note the "unique by construction"
// premise for "Ei Persona" does NOT rest on the value being a UUID — the two
// reserved personas ("ei", "emmet") carry those literal strings as their ids,
// not UUIDs. Whether "Ei Persona" values are actually unique per person is a
// genuinely open question, tracked as Proposed in
// docs/adr/ADR-006-ei-persona-link-multiplicity.md; this comment doesn't
// resolve it.
// Delegating to lookupById reuses all of its enrichment (embedding
// stripping, linked_quotes) with zero duplication; this does mean
// loadLatestState() is called twice on the not-found-then-found path,
// consistent with every other exported function in this file already
// calling it independently.
export async function lookupByIdentifier(type: string, value: string): Promise<({ type: string } & Record<string, unknown>) | null> {
  const state = await loadLatestState();
  if (!state) return null;
  const typeLower = type.toLowerCase();
  const person = state.human.people.find(p =>
    p.identifiers?.some(i => i.type.toLowerCase() === typeLower && i.value === value)
  );
  if (!person) return null;
  return lookupById(person.id);
}
