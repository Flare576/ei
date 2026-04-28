import type { PersonaEntity, HumanEntity, DataItemBase, Quote, RoomEntity, RoomMessage } from "./types.js";
import { RoomMode, ContextStatus } from "./types.js";
import { StateManager } from "./state-manager.js";
import { getEmbeddingService, findTopK } from "./embedding-service.js";
import type { ResponsePromptData, PromptOutput } from "../prompts/index.js";
import { buildRoomResponsePrompt } from "../prompts/room/index.js";
import type { RoomParticipantIdentity } from "../prompts/room/types.js";
import { normalizeRoomMessages, getMessageContent } from "./handlers/utils.js";

const QUOTE_LIMIT = 10;
const DATA_ITEM_LIMIT = 15;
const SIMILARITY_THRESHOLD = 0.3;
const HUMAN_CONTEXT_COMBINED_LIMIT = 10;
const HUMAN_CONTEXT_MIN_EACH = 2;

// =============================================================================
// COMBINED TOPICS + PEOPLE CAP
// =============================================================================

function capTopicsAndPeople<T extends { id: string }, P extends { id: string }>(
  topics: T[],
  people: P[]
): { topics: T[]; people: P[] } {
  const guaranteed = {
    topics: topics.slice(0, HUMAN_CONTEXT_MIN_EACH),
    people: people.slice(0, HUMAN_CONTEXT_MIN_EACH),
  };

  let remaining = HUMAN_CONTEXT_COMBINED_LIMIT - guaranteed.topics.length - guaranteed.people.length;
  const extraTopics: T[] = [];
  const extraPeople: P[] = [];
  let ti = HUMAN_CONTEXT_MIN_EACH;
  let pi = HUMAN_CONTEXT_MIN_EACH;

  while (remaining > 0 && (ti < topics.length || pi < people.length)) {
    if (ti < topics.length && remaining > 0) { extraTopics.push(topics[ti++]); remaining--; }
    if (pi < people.length && remaining > 0) { extraPeople.push(people[pi++]); remaining--; }
  }

  return {
    topics: [...guaranteed.topics, ...extraTopics],
    people: [...guaranteed.people, ...extraPeople],
  };
}

// =============================================================================
// EMBEDDING-BASED RELEVANCE SELECTION
// =============================================================================

const RECENT_MESSAGES_FOR_CONTEXT = 5;

async function buildQueryVectors(queries: string[]): Promise<number[][]> {
  const embeddingService = getEmbeddingService();
  return Promise.all(queries.map(q => embeddingService.embed(q)));
}

function unionTopK<T extends { id: string }>(
  candidates: T[],
  queryVectors: number[][],
  limit: number
): T[] {
  const best = new Map<string, { item: T; similarity: number }>();
  for (const qv of queryVectors) {
    for (const { item, similarity } of findTopK(qv, candidates, limit)) {
      const existing = best.get(item.id);
      if (!existing || similarity > existing.similarity) {
        best.set(item.id, { item, similarity });
      }
    }
  }
  return Array.from(best.values())
    .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ item }) => item);
}

async function selectRelevantItems<T extends { id: string; embedding?: number[] }>(
  items: T[],
  limit: number,
  queries: string[]
): Promise<T[]> {
  if (items.length === 0) return [];

  const withEmbeddings = items.filter((i) => i.embedding?.length);
  const activeQueries = queries.filter(Boolean);

  if (activeQueries.length > 0 && withEmbeddings.length > 0) {
    try {
      const queryVectors = await buildQueryVectors(activeQueries);
      const relevant = unionTopK(withEmbeddings, queryVectors, limit);
      if (relevant.length > 0) return relevant;
    } catch (err) {
      console.warn("[filterHumanDataByVisibility] Embedding search failed:", err);
    }
  }

  return [...items]
    .sort((a, b) => {
      const aTime = (a as { last_updated?: string }).last_updated ?? "";
      const bTime = (b as { last_updated?: string }).last_updated ?? "";
      return bTime.localeCompare(aTime);
    })
    .slice(0, limit);
}

async function selectRelevantQuotes(quotes: Quote[], queries: string[]): Promise<Quote[]> {
  if (quotes.length === 0) return [];
  const withEmbeddings = quotes.filter((q) => q.embedding?.length);
  const activeQueries = queries.filter(Boolean);

  if (activeQueries.length > 0 && withEmbeddings.length > 0) {
    try {
      const queryVectors = await buildQueryVectors(activeQueries);
      const relevant = unionTopK(withEmbeddings, queryVectors, QUOTE_LIMIT);
      if (relevant.length > 0) return relevant;
    } catch (err) {
      console.warn("[filterHumanDataByVisibility] Embedding search failed:", err);
    }
  }
  return [...quotes]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, QUOTE_LIMIT);
}

// =============================================================================
// GROUP VISIBILITY FILTERING
// =============================================================================

export async function filterHumanDataByVisibility(
  human: HumanEntity,
  persona: PersonaEntity,
  queries: string[]
): Promise<ResponsePromptData["human"]> {
  const DEFAULT_GROUP = "General";

  if (persona.id === "ei") {
    const [facts, rawTopics, rawPeople, quotes] = await Promise.all([
      selectRelevantItems(human.facts, DATA_ITEM_LIMIT, queries),
      selectRelevantItems(human.topics, DATA_ITEM_LIMIT, queries),
      selectRelevantItems(human.people, DATA_ITEM_LIMIT, queries),
      selectRelevantQuotes(human.quotes ?? [], queries),
    ]);
    const { topics, people } = capTopicsAndPeople(rawTopics, rawPeople);
    const humanName =
      human.settings?.name_display ||
      human.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
      "Human";
    return {
      name: humanName,
      facts,
      topics,
      people,
      quotes,
      active_topics: topics.filter(t => t.exposure_current > 0.3),
      interested_topics: topics.filter(t => t.exposure_desired - t.exposure_current > 0.2),
    };
  }

  const visibleGroups = new Set<string>();
  if (persona.group_primary) {
    visibleGroups.add(persona.group_primary);
  }
  (persona.groups_visible ?? []).forEach((g) => visibleGroups.add(g));

  const filterByGroup = <T extends DataItemBase>(items: T[]): T[] => {
    return items.filter((item) => {
      const itemGroups = item.persona_groups ?? [];
      const effectiveGroups = itemGroups.length === 0 ? [DEFAULT_GROUP] : itemGroups;
      return effectiveGroups.some((g) => visibleGroups.has(g));
    });
  };

  const groupFilteredQuotes = (human.quotes ?? []).filter((q) => {
    const effectiveGroups = q.persona_groups.length === 0 ? [DEFAULT_GROUP] : q.persona_groups;
    return effectiveGroups.some((g) => visibleGroups.has(g));
  });

  const [facts, rawTopics, rawPeople, quotes] = await Promise.all([
    selectRelevantItems(filterByGroup(human.facts), DATA_ITEM_LIMIT, queries),
    selectRelevantItems(filterByGroup(human.topics), DATA_ITEM_LIMIT, queries),
    selectRelevantItems(filterByGroup(human.people), DATA_ITEM_LIMIT, queries),
    selectRelevantQuotes(groupFilteredQuotes, queries),
  ]);
  const { topics, people } = capTopicsAndPeople(rawTopics, rawPeople);

  const humanName =
    human.settings?.name_display ||
    human.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
    "Human";
  return {
    name: humanName,
    facts,
    topics,
    people,
    quotes,
    active_topics: topics.filter(t => t.exposure_current > 0.3),
    interested_topics: topics.filter(t => t.exposure_desired - t.exposure_current > 0.2),
  };
}

// =============================================================================
// VISIBLE PERSONAS
// =============================================================================

export function getVisiblePersonas(
  sm: StateManager,
  currentPersona: PersonaEntity
): Array<{ name: string; short_description?: string }> {
  const allPersonas = sm.persona_getAll();

  if (currentPersona.id === "ei") {
    return allPersonas
      .filter((p) => p.id !== "ei" && !p.is_archived)
      .map((p) => ({
        name: p.display_name,
        short_description: p.short_description,
      }));
  }

  const visibleGroups = new Set<string>();
  if (currentPersona.group_primary) {
    visibleGroups.add(currentPersona.group_primary);
  }
  (currentPersona.groups_visible ?? []).forEach((g) => visibleGroups.add(g));

  if (visibleGroups.size === 0) {
    return [];
  }

  return allPersonas
    .filter((p) => {
      if (p.id === currentPersona.id || p.id === "ei" || p.is_archived) {
        return false;
      }
      return p.group_primary && visibleGroups.has(p.group_primary);
    })
    .map((p) => ({
      name: p.display_name,
      short_description: p.short_description,
    }));
}

// =============================================================================
// RESPONSE PROMPT DATA BUILDER
// =============================================================================

export async function buildResponsePromptData(
  sm: StateManager,
  persona: PersonaEntity,
  isTUI: boolean,
  currentMessage?: string,
  tools?: import("./types.js").ToolDefinition[]
): Promise<ResponsePromptData> {
  const human = sm.getHuman();
  const messages = sm.messages_get(persona.id);
  const previousMessage = messages.length >= 2 ? messages[messages.length - 2] : null;
  const delayMs = previousMessage
    ? Date.now() - new Date(previousMessage.timestamp).getTime()
    : 0;

  const recentMessageContents = messages
    .slice(-RECENT_MESSAGES_FOR_CONTEXT - 1, -1)
    .map(m => getMessageContent(m))
    .filter(Boolean);

  const queries = [
    ...(currentMessage ? [currentMessage] : []),
    ...recentMessageContents,
  ];

  const filteredHuman = await filterHumanDataByVisibility(human, persona, queries);
  const visiblePersonas = getVisiblePersonas(sm, persona);

  const alwaysMessages = sm.messages_getAlways(persona.id);
  const temporalAnchors = alwaysMessages.map(m => ({
    role: m.role === "human" ? "human" as const : "system" as const,
    content: m.content,
    silence_reason: m.silence_reason,
    timestamp: m.timestamp,
    _synthesis: m._synthesis,
  }));

  return {
    persona: {
      name: persona.display_name,
      aliases: persona.aliases ?? [],
      short_description: persona.short_description,
      long_description: persona.long_description,
      traits: persona.traits,
      topics: persona.topics,
      interested_topics: persona.topics.filter(t => t.exposure_desired - t.exposure_current > 0.2),
      include_message_timestamps: persona.include_message_timestamps,
    },
    human: filteredHuman,
    visible_personas: visiblePersonas,
    temporal_anchors: temporalAnchors,
    delay_ms: delayMs,
    isTUI,
    tools,
  };
}

export async function buildRoomResponsePromptData(
  sm: StateManager,
  room: RoomEntity,
  respondingPersona: PersonaEntity,
  isTUI: boolean,
  useAllMessages = false
): Promise<PromptOutput> {
  const MIN_ROOM_MESSAGES = 20;

  const human = sm.getHuman();
  const activePath = sm.getRoomActivePath(room.id);
  const allSourceMessages = useAllMessages
    ? [...sm.getRoomMessages(room.id)].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : activePath;

  let sourceMessages: RoomMessage[];
  if (room.mode === RoomMode.FreeForAll) {
    const contextWindowHours = room.context_window_hours
      ?? human.settings?.default_context_window_hours
      ?? 8;
    const windowCutoff = new Date(Date.now() - contextWindowHours * 60 * 60 * 1000).toISOString();
    const boundaryMs = room.context_boundary ? new Date(room.context_boundary).getTime() : 0;
    sourceMessages = allSourceMessages.filter(m => {
      const msgMs = new Date(m.timestamp).getTime();
      if (m.context_status === ContextStatus.Always) return true;
      if (m.context_status === ContextStatus.Never) return false;
      if (msgMs < new Date(windowCutoff).getTime()) return false;
      if (boundaryMs && msgMs < boundaryMs) return false;
      return true;
    });
    const byCount = allSourceMessages.slice(-MIN_ROOM_MESSAGES);
    if (byCount.length > sourceMessages.length) sourceMessages = byCount;
  } else {
    const contextWindowHours = human.settings?.default_context_window_hours ?? 8;
    const windowCutoff = new Date(Date.now() - contextWindowHours * 60 * 60 * 1000).toISOString();
    const byTime = allSourceMessages.filter(m => m.timestamp >= windowCutoff);
    const byCount = allSourceMessages.slice(-MIN_ROOM_MESSAGES);
    sourceMessages = byTime.length >= byCount.length ? byTime : byCount;
  }

  const lastMessage = sourceMessages[sourceMessages.length - 1];
  const currentMessage = lastMessage ? getMessageContent(lastMessage) : undefined;

  const filteredHuman = await filterHumanDataByVisibility(human, respondingPersona, currentMessage ? [currentMessage] : []);

  const history = normalizeRoomMessages(sourceMessages, sm);

  const otherParticipants: RoomParticipantIdentity[] = [];
  for (const pid of room.persona_ids) {
    if (pid === respondingPersona.id) continue;
    const p = sm.persona_getById(pid);
    if (p) {
      otherParticipants.push({
        id: p.id,
        name: p.display_name,
        short_description: p.short_description,
        long_description: p.long_description,
        traits: p.traits,
        is_human: false,
      });
    }
  }
  otherParticipants.push({
    id: "human",
    name:
      human.settings?.name_display ||
      human.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
      "Human",
    traits: [],
    is_human: true,
  });

  return buildRoomResponsePrompt({
    room: { display_name: room.display_name, mode: room.mode },
    responding_persona: {
      id: respondingPersona.id,
      name: respondingPersona.display_name,
      aliases: respondingPersona.aliases ?? [],
      short_description: respondingPersona.short_description,
      long_description: respondingPersona.long_description,
      traits: respondingPersona.traits,
      topics: respondingPersona.topics,
      include_message_timestamps: respondingPersona.include_message_timestamps,
    },
    other_participants: otherParticipants,
    human: filteredHuman,
    history,
    isTUI,
  });
}
