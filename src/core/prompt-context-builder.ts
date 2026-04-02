import type { PersonaEntity, HumanEntity, DataItemBase, Quote, RoomEntity } from "./types.js";
import { StateManager } from "./state-manager.js";
import { getEmbeddingService, findTopK } from "./embedding-service.js";
import type { ResponsePromptData, PromptOutput } from "../prompts/index.js";
import { buildRoomResponsePrompt } from "../prompts/room/index.js";
import type { RoomParticipantIdentity } from "../prompts/room/types.js";
import { normalizeRoomMessages } from "./handlers/utils.js";

const QUOTE_LIMIT = 10;
const DATA_ITEM_LIMIT = 15;
const SIMILARITY_THRESHOLD = 0.3;

// =============================================================================
// EMBEDDING-BASED RELEVANCE SELECTION
// =============================================================================

async function selectRelevantItems<T extends { id: string; embedding?: number[] }>(
  items: T[],
  limit: number,
  currentMessage?: string
): Promise<T[]> {
  if (items.length === 0) return [];

  const withEmbeddings = items.filter((i) => i.embedding?.length);

  if (currentMessage && withEmbeddings.length > 0) {
    try {
      const embeddingService = getEmbeddingService();
      const queryVector = await embeddingService.embed(currentMessage);
      const results = findTopK(queryVector, withEmbeddings, limit);
      const relevant = results
        .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
        .map(({ item }) => item);

      if (relevant.length > 0) return relevant;
    } catch (err) {
      console.warn("[filterHumanDataByVisibility] Embedding search failed:", err);
    }
  }

  // Fallback: return top items by recency
  return [...items]
    .sort((a, b) => {
      const aTime = (a as { last_updated?: string }).last_updated ?? "";
      const bTime = (b as { last_updated?: string }).last_updated ?? "";
      return bTime.localeCompare(aTime);
    })
    .slice(0, limit);
}

async function selectRelevantQuotes(quotes: Quote[], currentMessage?: string): Promise<Quote[]> {
  if (quotes.length === 0) return [];
  const withEmbeddings = quotes.filter((q) => q.embedding?.length);

  if (currentMessage && withEmbeddings.length > 0) {
    try {
      const embeddingService = getEmbeddingService();
      const queryVector = await embeddingService.embed(currentMessage);
      const results = findTopK(queryVector, withEmbeddings, QUOTE_LIMIT);
      const relevant = results
        .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
        .map(({ item }) => item);

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
  currentMessage?: string
): Promise<ResponsePromptData["human"]> {
  const DEFAULT_GROUP = "General";

  if (persona.id === "ei") {
    const [facts, topics, people, quotes] = await Promise.all([
      selectRelevantItems(human.facts, DATA_ITEM_LIMIT, currentMessage),
      selectRelevantItems(human.topics, DATA_ITEM_LIMIT, currentMessage),
      selectRelevantItems(human.people, DATA_ITEM_LIMIT, currentMessage),
      selectRelevantQuotes(human.quotes ?? [], currentMessage),
    ]);
    return {
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

  const [facts, topics, people, quotes] = await Promise.all([
    selectRelevantItems(filterByGroup(human.facts), DATA_ITEM_LIMIT, currentMessage),
    selectRelevantItems(filterByGroup(human.topics), DATA_ITEM_LIMIT, currentMessage),
    selectRelevantItems(filterByGroup(human.people), DATA_ITEM_LIMIT, currentMessage),
    selectRelevantQuotes(groupFilteredQuotes, currentMessage),
  ]);

  return {
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
  const filteredHuman = await filterHumanDataByVisibility(human, persona, currentMessage);
  const visiblePersonas = getVisiblePersonas(sm, persona);
  const messages = sm.messages_get(persona.id);
  const previousMessage = messages.length >= 2 ? messages[messages.length - 2] : null;
  const delayMs = previousMessage
    ? Date.now() - new Date(previousMessage.timestamp).getTime()
    : 0;

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
  const human = sm.getHuman();
  const activePath = sm.getRoomActivePath(room.id);
  const sourceMessages = useAllMessages
    ? [...sm.getRoomMessages(room.id)].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : activePath;
  const lastMessage = sourceMessages[sourceMessages.length - 1];
  const currentMessage = lastMessage?.verbal_response;

  const filteredHuman = await filterHumanDataByVisibility(human, respondingPersona, currentMessage);

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
    name: human.settings?.name_display ?? "Human",
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
