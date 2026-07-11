import { LLMRequestType, LLMPriority, LLMNextStep, type Message, type PersonaTopic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  buildPersonaTopicRatingPrompt,
} from "../../prompts/persona/index.js";
import { chunkExtractionContext } from "./extraction-chunker.js";
import { resolveTokenLimit } from "../llm-client.js";

export interface PersonaTopicContext {
  personaId: string;
  personaDisplayName: string;
  messages_context: Message[];
  messages_analyze: Message[];
  topics: PersonaTopic[];
}

export interface PersonaTopicOptions {
  ceremony_progress?: number;
  roomId?: string;
}

const EXTRACTION_BUDGET_RATIO = 0.75;
const MIN_EXTRACTION_TOKENS = 10000;

function getExtractionMaxTokens(state: StateManager): number {
  const human = state.getHuman();
  const modelForTokenLimit = human.settings?.extraction_model ?? human.settings?.conversation_model;
  const tokenLimit = resolveTokenLimit(modelForTokenLimit, human.settings?.accounts);
  return Math.max(MIN_EXTRACTION_TOKENS, Math.floor(tokenLimit * EXTRACTION_BUDGET_RATIO));
}

export function queuePersonaTopicRating(
  context: PersonaTopicContext,
  state: StateManager,
  options?: PersonaTopicOptions
): void {
  const maxTokens = getExtractionMaxTokens(state);
  const { chunks } = chunkExtractionContext(
    {
      personaId: context.personaId,
      channelDisplayName: context.personaDisplayName,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
    maxTokens
  );

  if (chunks.length === 0) {
    console.log(`[queuePersonaTopicRating] No chunks to process for ${context.personaDisplayName}`);
    return;
  }

  // Mark messages BEFORE queueing to prevent duplicate queueing
  const shortId = context.personaId.slice(0, 8);
  const allAnalyzeIds = context.messages_analyze.map(m => m.id);
  if (options?.roomId) {
    state.markRoomMessagesPersonaExtracted(options.roomId, allAnalyzeIds, shortId);
  } else {
    state.messages_markPersonaExtracted(context.personaId, allAnalyzeIds, shortId);
  }

  for (const chunk of chunks) {
    const topicsForPrompt = context.topics.map(t => ({
      id: t.id,
      name: t.name,
      description_hint: t.perspective?.slice(0, 80) || t.name,
    }));

    const prompt = buildPersonaTopicRatingPrompt({
      persona_name: context.personaDisplayName,
      topics: topicsForPrompt,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandlePersonaTopicRating,
      data: {
        personaId: context.personaId,
        personaDisplayName: context.personaDisplayName,
        message_ids: chunk.messages_analyze.map(m => m.id),
        ceremony_progress: options?.ceremony_progress,
        roomId: options?.roomId,
      },
    });
  }

  console.log(`[queuePersonaTopicRating] Queued ${chunks.length} rating chunk(s) for ${context.personaDisplayName}`);
}
