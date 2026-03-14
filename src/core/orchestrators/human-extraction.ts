import { LLMRequestType, LLMPriority, LLMNextStep, type Message, type DataItemType, type Fact, type Topic, type Person } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  buildFactFindPrompt,
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
  buildHumanItemMatchPrompt,
  buildHumanItemUpdatePrompt,
  type FactScanCandidate,
  type TopicScanCandidate,
  type PersonScanCandidate,
  type ItemMatchResult,
} from "../../prompts/human/index.js";
import { chunkExtractionContext } from "./extraction-chunker.js";
import { getEmbeddingService, findTopK } from "../embedding-service.js";
import { resolveTokenLimit } from "../llm-client.js";
import { BUILT_IN_FACT_NAMES } from "../constants/built-in-facts.js";

type ScanCandidate = FactScanCandidate | TopicScanCandidate | PersonScanCandidate;

export interface ExtractionContext {
  personaId: string;
  personaDisplayName: string;
  messages_context: Message[];
  messages_analyze: Message[];
  extraction_flag?: "f" | "t" | "p";
}

export interface ExtractionOptions {
  /** Ceremony phase number (1=Dedup, 2=Expose) */
  ceremony_progress?: number;
  /** Override model for extraction LLM calls */
  extraction_model?: string;
  /** Override token budget for chunking */
  extraction_token_limit?: number;
}

function getAnalyzeFromTimestamp(context: ExtractionContext): string | null {
  if (context.messages_analyze.length === 0) return null;
  return context.messages_analyze[0].timestamp;
}

const EXTRACTION_BUDGET_RATIO = 0.75;
const MIN_EXTRACTION_TOKENS = 10000;

function getExtractionMaxTokens(state: StateManager, options?: ExtractionOptions): number {
  if (options?.extraction_token_limit) {
    return Math.max(MIN_EXTRACTION_TOKENS, Math.floor(options.extraction_token_limit * EXTRACTION_BUDGET_RATIO));
  }
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

  for (const chunk of chunks) {
    const prompt = buildHumanPersonScanPrompt({
      persona_name: chunk.personaDisplayName,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
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
    const prompt = buildHumanItemUpdatePrompt({
      data_type: "topic",
      existing_item: topic,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      persona_name: chunk.personaDisplayName,
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      model: extractionModel,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHumanItemUpdate,
      data: {
        personaId: context.personaId,
        personaDisplayName: context.personaDisplayName,
        candidateType: "topic",
        matchedType: "topic",
        isNewItem: false,
        existingItemId: topic.id,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
      },
    });
  }

  return chunks.length;
}

function truncateDescription(description: string, maxLength: number = 255): string {
  if (description.length <= maxLength) return description;
  return description.slice(0, maxLength) + "...";
}

const EMBEDDING_TOP_K = 20;
const EMBEDDING_MIN_SIMILARITY = 0.3;

/**
 * Queue an item match request using embedding-based similarity.
 * 
 * Instead of sending ALL items to the LLM, we:
 * 1. Compute embedding for the candidate (name + value)
 * 2. Find top-K most similar existing items via cosine similarity
 * 3. Send only those candidates to the LLM for final matching decision
 * 
 * This reduces prompt size from O(all_items) to O(K) where K=20.
 */
export async function queueItemMatch(
  dataType: DataItemType,
  candidate: ScanCandidate,
  context: ExtractionContext,
  state: StateManager,
  extractionModel?: string
): Promise<void> {
  const human = state.getHuman();
  
  let itemName: string;
  let itemValue: string;

  switch (dataType) {
    case "fact":
      itemName = (candidate as FactScanCandidate).type_of_fact;
      itemValue = (candidate as FactScanCandidate).value_of_fact;
      break;

    case "topic":
      itemName = (candidate as TopicScanCandidate).value_of_topic;
      itemValue = (candidate as TopicScanCandidate).type_of_topic;
      break;
    case "person":
      itemName = (candidate as PersonScanCandidate).name_of_person;
      itemValue = (candidate as PersonScanCandidate).type_of_person;
      break;
    default:
      throw new Error(`[queueItemMatch] Unsupported dataType: ${dataType}`);
  }

  const allItemsWithEmbeddings = [
    ...human.facts.map(f => ({ ...f, data_type: "fact" as DataItemType })),
    ...human.topics.map(t => ({ ...t, data_type: "topic" as DataItemType })),
    ...human.people.map(p => ({ ...p, data_type: "person" as DataItemType })),
  ].filter(item => item.embedding && item.embedding.length > 0);

  let topKItems: Array<{
    data_type: DataItemType;
    data_id: string;
    data_name: string;
    data_description: string;
  }> = [];

  if (allItemsWithEmbeddings.length > 0) {
    try {
      const embeddingService = getEmbeddingService();
      const candidateText = `${itemName}: ${itemValue}`;
      const candidateVector = await embeddingService.embed(candidateText);

      const topK = findTopK(candidateVector, allItemsWithEmbeddings, EMBEDDING_TOP_K);
      
      topKItems = topK
        .filter(({ similarity }) => similarity >= EMBEDDING_MIN_SIMILARITY)
        .map(({ item }) => ({
          data_type: item.data_type,
          data_id: item.id,
          data_name: item.name,
          data_description: item.data_type === dataType 
            ? item.description 
            : truncateDescription(item.description),
        }));

      console.log(`[queueItemMatch] Embedding search: ${allItemsWithEmbeddings.length} items → ${topKItems.length} candidates (top-K=${EMBEDDING_TOP_K}, min_sim=${EMBEDDING_MIN_SIMILARITY})`);
    } catch (err) {
      console.error(`[queueItemMatch] Embedding search failed, falling back to all items:`, err);
    }
  }

  if (topKItems.length === 0) {

    console.log(`[queueItemMatch] No embeddings available, using filtered items (dataType=${dataType})`);

    for (const fact of human.facts) {
      topKItems.push({
        data_type: "fact",
        data_id: fact.id,
        data_name: fact.name,
        data_description: dataType === "fact" ? fact.description : truncateDescription(fact.description),
      });
    }

    for (const topic of human.topics) {
      topKItems.push({
        data_type: "topic",
        data_id: topic.id,
        data_name: topic.name,
        data_description: dataType === "topic" ? topic.description : truncateDescription(topic.description),
      });
    }

    for (const person of human.people) {
      topKItems.push({
        data_type: "person",
        data_id: person.id,
        data_name: person.name,
        data_description: dataType === "person" ? person.description : truncateDescription(person.description),
      });
    }
  }

  const prompt = buildHumanItemMatchPrompt({
    candidate_type: dataType,
    candidate_name: itemName,
    candidate_value: itemValue,
    all_items: topKItems,
  });



  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    model: extractionModel,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanItemMatch,
    data: {
      ...context,
      candidateType: dataType,
      itemName,
      itemValue,
      extraction_model: extractionModel,
    },
  });
}

export function queueItemUpdate(
  candidateType: DataItemType,
  matchResult: ItemMatchResult,
  context: ExtractionContext & { itemName: string; itemValue: string; itemCategory?: string; extraction_model?: string },
  state: StateManager
): number {
  const human = state.getHuman();
  const matchedGuid = matchResult.matched_guid;
  const isNewItem = matchedGuid === null;

  let existingItem: Fact | Topic | Person | null = null;
  let matchedType: DataItemType | null = null;

  if (!isNewItem) {
    existingItem = human.facts.find(f => f.id === matchedGuid) ?? null;
    if (existingItem) matchedType = "fact";


    if (!existingItem) {
      existingItem = human.topics.find(t => t.id === matchedGuid) ?? null;
      if (existingItem) matchedType = "topic";
    }

    if (!existingItem) {
      existingItem = human.people.find(p => p.id === matchedGuid) ?? null;
      if (existingItem) matchedType = "person";
    }
  }

  const extractionOptions: ExtractionOptions = { extraction_model: context.extraction_model };
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state, extractionOptions));

  if (chunks.length === 0) return 0;

  for (const chunk of chunks) {
    const prompt = buildHumanItemUpdatePrompt({
      data_type: candidateType,
      existing_item: existingItem,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      persona_name: chunk.personaDisplayName,
      new_item_name: isNewItem ? context.itemName : undefined,
      new_item_value: isNewItem ? context.itemValue : undefined,
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      model: context.extraction_model,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHumanItemUpdate,
      data: {
        personaId: context.personaId,
        personaDisplayName: context.personaDisplayName,
        candidateType,
        matchedType,
        isNewItem,
        existingItemId: existingItem?.id,
        itemCategory: context.itemCategory,
        analyze_from_timestamp: getAnalyzeFromTimestamp(chunk),
      },
    });
  }

  return chunks.length;
}
