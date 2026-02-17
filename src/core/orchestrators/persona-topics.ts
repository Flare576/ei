import { LLMRequestType, LLMPriority, LLMNextStep, type Message, type PersonaTopic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  buildPersonaTopicScanPrompt,
  buildPersonaTopicMatchPrompt,
  buildPersonaTopicUpdatePrompt,
  type PersonaTopicScanCandidate,
  type PersonaTopicMatchResult,
} from "../../prompts/persona/index.js";

export interface PersonaTopicContext {
  personaId: string;
  personaDisplayName: string;
  messages_context: Message[];
  messages_analyze: Message[];
}

function getAnalyzeFromTimestamp(context: PersonaTopicContext): string | null {
  if (context.messages_analyze.length === 0) return null;
  return context.messages_analyze[0].timestamp;
}

export function queuePersonaTopicScan(context: PersonaTopicContext, state: StateManager): void {
  const prompt = buildPersonaTopicScanPrompt({
    persona_name: context.personaDisplayName,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaTopicScan,
    data: {
      personaId: context.personaId,
      personaDisplayName: context.personaDisplayName,
      analyze_from_timestamp: getAnalyzeFromTimestamp(context),
    },
  });
}

export function queuePersonaTopicMatch(
  candidate: PersonaTopicScanCandidate,
  context: PersonaTopicContext,
  state: StateManager
): void {
  const persona = state.persona_getById(context.personaId);
  if (!persona) {
    console.error(`[queuePersonaTopicMatch] Persona not found: ${context.personaId}`);
    return;
  }

  const prompt = buildPersonaTopicMatchPrompt({
    persona_name: context.personaDisplayName,
    candidate,
    existing_topics: persona.topics,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaTopicMatch,
    data: {
      personaId: context.personaId,
      personaDisplayName: context.personaDisplayName,
      candidate,
      analyze_from_timestamp: getAnalyzeFromTimestamp(context),
    },
  });
}

export function queuePersonaTopicUpdate(
  candidate: PersonaTopicScanCandidate,
  matchResult: PersonaTopicMatchResult,
  context: PersonaTopicContext,
  state: StateManager
): void {
  const persona = state.persona_getById(context.personaId);
  if (!persona) {
    console.error(`[queuePersonaTopicUpdate] Persona not found: ${context.personaId}`);
    return;
  }

  const existingTopic = matchResult.matched_id
    ? persona.topics.find((t: PersonaTopic) => t.id === matchResult.matched_id)
    : undefined;

  const prompt = buildPersonaTopicUpdatePrompt({
    persona_name: context.personaDisplayName,
    short_description: persona.short_description,
    long_description: persona.long_description,
    traits: persona.traits,
    existing_topic: existingTopic,
    candidate,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaTopicUpdate,
    data: {
      personaId: context.personaId,
      personaDisplayName: context.personaDisplayName,
      candidate,
      matched_id: matchResult.matched_id,
      analyze_from_timestamp: getAnalyzeFromTimestamp(context),
    },
  });
}
