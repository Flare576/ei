import { LLMRequestType, LLMPriority, LLMNextStep, type Message, type Topic, type Person } from "../types.js";
import type { PersonIdentifier } from "../types/data-items.js";
import type { StateManager } from "../state-manager.js";
import {
  buildFactFindPrompt,
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
  buildTopicMatchPrompt,
  buildTopicUpdatePrompt,
  buildPersonUpdatePrompt,
  buildEventScanPrompt,
  type TopicScanCandidate,
  type ItemMatchResult,
  type ParticipantContext,
} from "../../prompts/human/index.js";
import { chunkExtractionContext } from "./extraction-chunker.js";
import { getEmbeddingService, findTopK, getTopicEmbeddingText } from "../embedding-service.js";
import { resolveTokenLimit } from "../llm-client.js";
import { BUILT_IN_FACT_NAMES } from "../constants/built-in-facts.js";
import { buildEventWindows } from "../utils/event-windows.js";

function buildParticipantContext(personaId: string, state: StateManager): ParticipantContext {
  const persona = state.persona_getById(personaId);
  const human = state.getHuman();

  const persona_description = persona?.long_description || undefined;

  const fullNameFact = human.facts.find(f => f.name === "Full Name");
  const nicknameFact = human.facts.find(f => f.name === "Nickname/Preferred Name");
  const fullName = fullNameFact?.description || "";
  const nickname = nicknameFact?.description || "";
  let human_name: string | undefined;
  if (fullName && nickname) human_name = `${fullName} (${nickname})`;
  else if (fullName) human_name = fullName;
  else if (nickname) human_name = nickname;

  let human_age: number | undefined;
  const birthdayFact = human.facts.find(f => f.name === "Birthday");
  if (birthdayFact?.description) {
    const birth = new Date(birthdayFact.description);
    if (!isNaN(birth.getTime())) {
      human_age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }

  return {
    persona_name: persona?.display_name ?? personaId,
    persona_description,
    human_name,
    human_age,
  };
}

export interface ExtractionContext {
  personaId: string;
  personaDisplayName: string;
  messages_context: Message[];
  messages_analyze: Message[];
  extraction_flag?: "f" | "t" | "p" | "e";
  roomId?: string;
}

export interface ExtractionOptions {
  /** Ceremony phase number (1=Dedup, 2=Expose) */
  ceremony_progress?: number;
  /** Override model for extraction LLM calls */
  extraction_model?: string;
  /**
   * Controls whether external (integration-imported) messages are included.
   * - "exclude": skip messages where external === true
   * - "only": include ONLY messages where external === true
   * - "include": include all messages (backward-compat default; omit means same)
   *
   * NOTE: "include" is the backward-compat default only. All new callers must explicitly pass "exclude" or "only". Will be removed in a future release.
   */
  external_filter?: "include" | "exclude" | "only";
}

function getAnalyzeFromTimestamp(context: ExtractionContext): string | null {
  if (context.messages_analyze.length === 0) return null;
  return context.messages_analyze[0].timestamp;
}

const EXTRACTION_BUDGET_RATIO = 0.75;
const MIN_EXTRACTION_TOKENS = 10000;

function getExtractionMaxTokens(state: StateManager, options?: ExtractionOptions): number {
  const human = state.getHuman();
  const modelForTokenLimit = options?.extraction_model ?? human.settings?.default_model;
  const tokenLimit = resolveTokenLimit(modelForTokenLimit, human.settings?.accounts);
  return Math.max(MIN_EXTRACTION_TOKENS, Math.floor(tokenLimit * EXTRACTION_BUDGET_RATIO));
}

export function queueFactFind(context: ExtractionContext, state: StateManager, options?: ExtractionOptions): number {
  const human = state.getHuman();
  const extractionModel = options?.extraction_model;
  const missing_fact_names = human.facts
    .filter(f => !f.description || f.description === "")
    .map(f => f.name)
    .filter(name => BUILT_IN_FACT_NAMES.has(name));

  if (missing_fact_names.length === 0) return 0;

  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, options));

  // Pre-mark messages before enqueuing — prevents duplicate scans if the
  // queue check fires again during LLM latency (100ms loop × 5s call = 50 dupes)
  for (const chunk of chunks) {
    state.messages_markExtracted(chunk.personaId, chunk.messages_analyze.map(m => m.id), "f");
  }

  for (const chunk of chunks) {
    const prompt = buildFactFindPrompt({
      persona_name: chunk.personaDisplayName,
      missing_fact_names,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      model: extractionModel,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleFactFind,
      data: {
        ...options,
        personaId: chunk.personaId,
        personaDisplayName: chunk.personaDisplayName,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
        extraction_flag: context.extraction_flag,
        message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
      },
    });
  }

  return chunks.length;
}

export function queueTopicScan(context: ExtractionContext, state: StateManager, options?: ExtractionOptions): number {
  const extractionModel = options?.extraction_model;
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, options));
  
  if (chunks.length === 0) return 0;

  // Pre-mark messages before enqueuing — prevents duplicate scans if the
  // queue check fires again during LLM latency (100ms loop × 5s call = 50 dupes)
  for (const chunk of chunks) {
    state.messages_markExtracted(chunk.personaId, chunk.messages_analyze.map(m => m.id), "t");
  }

  for (const chunk of chunks) {
    const prompt = buildHumanTopicScanPrompt({
      persona_name: chunk.personaDisplayName,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      participant_context: buildParticipantContext(context.personaId, state),
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      model: extractionModel,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHumanTopicScan,
      data: {
        ...options,
        personaId: chunk.personaId,
        personaDisplayName: chunk.personaDisplayName,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
        extraction_flag: context.extraction_flag,
        message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
      },
    });
  }

  return chunks.length;
}

export function queuePersonScan(context: ExtractionContext, state: StateManager, options?: ExtractionOptions): number {
  const extractionModel = options?.extraction_model;
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, options));
  
  if (chunks.length === 0) return 0;

  // Pre-mark messages before enqueuing — prevents duplicate scans if the
  // queue check fires again during LLM latency (100ms loop × 5s call = 50 dupes)
  for (const chunk of chunks) {
    state.messages_markExtracted(chunk.personaId, chunk.messages_analyze.map(m => m.id), "p");
  }

  const humanForScan = state.getHuman();
  const userIdentifierTypesForScan = [...new Set(
    humanForScan.people
      .flatMap(p => (p.identifiers ?? []).map(i => i.type))
      .filter(Boolean)
  )];

  for (const chunk of chunks) {
    const prompt = buildHumanPersonScanPrompt({
      persona_name: chunk.personaDisplayName,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      participant_context: buildParticipantContext(context.personaId, state),
      known_identifier_types: userIdentifierTypesForScan,
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      model: extractionModel,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHumanPersonScan,
      data: {
        ...options,
        personaId: chunk.personaId,
        personaDisplayName: chunk.personaDisplayName,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
        extraction_flag: context.extraction_flag,
        message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
      },
    });
  }

  return chunks.length;
}

export function queueAllScans(context: ExtractionContext, state: StateManager, options?: ExtractionOptions): void {
  queueFactFind(context, state, options);
  queuePersonScan(context, state, options);
  queueTopicScan(context, state, options);
  queueEventSummary(context.personaId, state, options);
}

/**
 * Queue a direct Topic Update, bypassing scan/match.
 * 
 * Use this when we KNOW the topic already exists (e.g., OpenCode sessions
 * where each session IS a topic). This avoids the queue explosion from
 * scan → match → update pipeline.
 * 
 * @param topic - The known Topic to update
 * @param context - Messages to analyze for this topic
 * @param state - StateManager for queue operations
 * @returns Number of chunks queued
 */
export function queueDirectTopicUpdate(
  topic: import("../types.js").Topic,
  context: ExtractionContext,
  state: StateManager,
  options?: ExtractionOptions
): number {
  const extractionModel = options?.extraction_model;
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, options));

  if (chunks.length === 0) return 0;

  for (const chunk of chunks) {
    const prompt = buildTopicUpdatePrompt({
      existing_item: topic,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      persona_name: chunk.personaDisplayName,
      participant_context: buildParticipantContext(context.personaId, state),
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      model: extractionModel,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        personaId: context.personaId,
        personaDisplayName: context.personaDisplayName,
        isNewItem: false,
        existingItemId: topic.id,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
      },
    });
  }

  return chunks.length;
}

const EMBEDDING_TOP_K = 20;
const EMBEDDING_MIN_SIMILARITY = 0.3;

/**
 * Queue a topic match request using embedding-based similarity (topics only).
 */
export async function queueTopicMatch(
  candidate: TopicScanCandidate,
  context: ExtractionContext,
  state: StateManager,
  extractionModel?: string
): Promise<void> {
  const human = state.getHuman();

  const topicsWithEmbeddings = human.topics.filter(t => t.embedding && t.embedding.length > 0);

  let topKItems: Array<{ id: string; name: string; description: string; category?: string }> = [];

  if (topicsWithEmbeddings.length > 0) {
    try {
      const embeddingService = getEmbeddingService();
      const candidateText = getTopicEmbeddingText({
        name: candidate.name,
        category: candidate.category,
        description: candidate.description,
      });
      const candidateVector = await embeddingService.embed(candidateText);

      const topK = findTopK(candidateVector, topicsWithEmbeddings, EMBEDDING_TOP_K);
      topKItems = topK
        .filter(({ similarity }) => similarity >= EMBEDDING_MIN_SIMILARITY)
        .map(({ item }) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
        }));

      console.log(`[queueTopicMatch] Embedding search: ${topicsWithEmbeddings.length} topics → ${topKItems.length} candidates`);
      if (topKItems.length > 0) state.embedding_setWarning(false);
    } catch (err) {
      console.error(`[queueTopicMatch] Embedding search failed, falling back to recent topics:`, err);
      state.embedding_setWarning(true);
    }
  }

  if (topKItems.length === 0) {
    const sorted = [...human.topics].sort((a, b) => {
      const aDate = a.last_mentioned ?? a.last_updated;
      const bDate = b.last_mentioned ?? b.last_updated;
      return bDate.localeCompare(aDate);
    });
    topKItems = sorted.slice(0, EMBEDDING_TOP_K).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
    }));
    console.log(`[queueTopicMatch] No embedding matches, using ${topKItems.length} most-recent topics`);
  }

  const prompt = buildTopicMatchPrompt({
    candidate_name: candidate.name,
    candidate_description: candidate.description,
    candidate_category: candidate.category,
    existing_topics: topKItems,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    model: extractionModel,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleTopicMatch,
    data: {
      ...context,
      candidateName: candidate.name,
      candidateDescription: candidate.description,
      candidateCategory: candidate.category,
      extraction_model: extractionModel,
    },
  });
}

export function queueTopicUpdate(
  matchResult: ItemMatchResult,
  context: ExtractionContext & {
    candidateName: string;
    candidateDescription: string;
    candidateCategory: string;
    extraction_model?: string;
  },
  state: StateManager
): number {
  const human = state.getHuman();
  const matchedGuid = matchResult.matched_guid;
  const isNewItem = matchedGuid === null;

  let existingItem: Topic | null = null;
  if (!isNewItem && matchedGuid) {
    existingItem = human.topics.find(t => t.id === matchedGuid) ?? null;
  }

  const extractionOptions: ExtractionOptions = { extraction_model: context.extraction_model };
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, extractionOptions));

  if (chunks.length === 0) return 0;

  for (const chunk of chunks) {
    const primaryPersonaId = context.personaId.split("|")[0];
    const prompt = buildTopicUpdatePrompt({
      existing_item: existingItem,
      new_topic_name: isNewItem ? context.candidateName : undefined,
      new_topic_description: isNewItem ? context.candidateDescription : undefined,
      new_topic_category: isNewItem ? context.candidateCategory : undefined,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      persona_name: chunk.personaDisplayName,
      participant_context: buildParticipantContext(primaryPersonaId, state),
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      model: context.extraction_model,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        personaId: context.personaId,
        personaDisplayName: context.personaDisplayName,
        roomId: context.roomId,
        isNewItem,
        existingItemId: existingItem?.id,
        candidateName: isNewItem ? context.candidateName : undefined,
        candidateCategory: context.candidateCategory,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
      },
    });
  }

  return chunks.length;
}

export function queueEventSummary(
  personaId: string,
  state: StateManager,
  options?: ExtractionOptions
): number {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[queueEventSummary] Persona not found: ${personaId}`);
    return 0;
  }

  const unextractedMessages = state.messages_getUnextracted(personaId, "e", undefined, options?.external_filter);
  if (unextractedMessages.length === 0) {
    console.log(`[queueEventSummary] No unprocessed messages for ${persona.display_name}`);
    return 0;
  }

  const human = state.getHuman();
  const gapHours = human.settings?.ceremony?.event_window_hours ?? 8;

  const sorted = [...unextractedMessages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const windows = buildEventWindows(sorted, gapHours);

  const allMessages = state.messages_get(personaId);
  const extractionModel = options?.extraction_model;
  let totalChunks = 0;

  state.messages_markExtracted(personaId, sorted.map(m => m.id), "e");

  for (const windowMessages of windows) {
    if (windowMessages.length === 0) continue;

    const windowStartTime = new Date(windowMessages[0].timestamp).getTime();
    const messages_context = allMessages.filter(
      m => m.e === true && new Date(m.timestamp).getTime() < windowStartTime
    );

    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context,
      messages_analyze: windowMessages,
      extraction_flag: "e",
    };

    const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, options));

    for (const chunk of chunks) {
      const prompt = buildEventScanPrompt({
        persona_name: chunk.personaDisplayName,
        messages_context: chunk.messages_context,
        messages_analyze: chunk.messages_analyze,
        participant_context: buildParticipantContext(personaId, state),
      });

      state.queue_enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        model: extractionModel,
        system: prompt.system,
        user: prompt.user,
        next_step: LLMNextStep.HandleEventScan,
        data: {
          ...options,
          personaId: chunk.personaId,
          personaDisplayName: chunk.personaDisplayName,
          extraction_flag: "e",
          message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
        },
      });
      totalChunks++;
    }
  }

  console.log(`[queueEventSummary] Queued ${totalChunks} event scan chunk(s) for ${persona.display_name} (${windows.length} window(s))`);
  return totalChunks;
}

export function queuePersonUpdate(
  matchResult: ItemMatchResult,
  context: ExtractionContext & {
    candidateName: string;
    candidateDescription: string;
    candidateRelationship: string;
    candidateIdentifiers?: PersonIdentifier[];
    extraction_model?: string;
  },
  state: StateManager
): number {
  const human = state.getHuman();
  const matchedGuid = matchResult.matched_guid;
  const isNewItem = matchedGuid === null;

  let existingItem: Person | null = null;
  if (!isNewItem && matchedGuid) {
    existingItem = human.people.find(p => p.id === matchedGuid) ?? null;
  }

  const candidateIdentifiers = context.candidateIdentifiers ?? [];

  if (!isNewItem && existingItem && candidateIdentifiers.length > 0) {
    const merged = [...(existingItem.identifiers ?? [])];
    for (const ci of candidateIdentifiers) {
      if (!merged.some(ei => ei.value === ci.value)) {
        merged.push(ci);
      }
    }
    existingItem = { ...existingItem, identifiers: merged };
    state.human_person_upsert(existingItem);
  }

  const userIdentifierTypes = [...new Set(
    human.people
      .flatMap(p => (p.identifiers ?? []).map(i => i.type))
      .filter(Boolean)
  )];

  const extractionOptions: ExtractionOptions = { extraction_model: context.extraction_model };
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, extractionOptions));

  if (chunks.length === 0) return 0;

  const primaryPersonaIdForUpdate = context.personaId.split("|")[0];

  for (const chunk of chunks) {
    const prompt = buildPersonUpdatePrompt({
      existing_item: existingItem,
      new_person_name: isNewItem ? context.candidateName : undefined,
      new_person_description: isNewItem ? context.candidateDescription : undefined,
      new_person_relationship: isNewItem ? context.candidateRelationship : undefined,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      persona_name: chunk.personaDisplayName,
      participant_context: buildParticipantContext(primaryPersonaIdForUpdate, state),
      known_identifier_types: userIdentifierTypes,
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      model: context.extraction_model,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        personaId: context.personaId,
        personaDisplayName: context.personaDisplayName,
        roomId: context.roomId,
        isNewItem,
        existingItemId: existingItem?.id,
        candidateName: context.candidateName,
        candidateRelationship: context.candidateRelationship,
        candidateIdentifiers: isNewItem ? candidateIdentifiers : undefined,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
      },
    });
  }

  return chunks.length;
}


