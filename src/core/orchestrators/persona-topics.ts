import { LLMRequestType, LLMPriority, LLMNextStep, type Message } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  buildPersonaTopicScanPrompt,
  buildPersonaTopicMatchPrompt,
  buildPersonaTopicUpdatePrompt,
  type PersonaTopicScanCandidate,
  type PersonaTopicMatchResult,
} from "../../prompts/persona/index.js";

export interface PersonaTopicContext {
  personaName: string;
  messages_context: Message[];
  messages_analyze: Message[];
}

function getAnalyzeFromTimestamp(context: PersonaTopicContext): string | null {
  if (context.messages_analyze.length === 0) return null;
  return context.messages_analyze[0].timestamp;
}

export function queuePersonaTopicScan(context: PersonaTopicContext, state: StateManager): void {
  const prompt = buildPersonaTopicScanPrompt({
    persona_name: context.personaName,
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
      personaName: context.personaName,
      analyze_from_timestamp: getAnalyzeFromTimestamp(context),
    },
  });
}

export function queuePersonaTopicMatch(
  candidate: PersonaTopicScanCandidate,
  context: PersonaTopicContext,
  state: StateManager
): void {
  const persona = state.persona_get(context.personaName);
  if (!persona) {
    console.error(`[queuePersonaTopicMatch] Persona not found: ${context.personaName}`);
    return;
  }

  const prompt = buildPersonaTopicMatchPrompt({
    persona_name: context.personaName,
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
      personaName: context.personaName,
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
  const persona = state.persona_get(context.personaName);
  if (!persona) {
    console.error(`[queuePersonaTopicUpdate] Persona not found: ${context.personaName}`);
    return;
  }

  const existingTopic = matchResult.matched_id
    ? persona.topics.find(t => t.id === matchResult.matched_id)
    : undefined;

  const prompt = buildPersonaTopicUpdatePrompt({
    persona_name: context.personaName,
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
      personaName: context.personaName,
      candidate,
      existingTopicId: matchResult.matched_id ?? null,
      isNewTopic: matchResult.action === "create",
      analyze_from_timestamp: getAnalyzeFromTimestamp(context),
    },
  });
}
