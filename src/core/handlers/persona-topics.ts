import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  type LLMResponse,
  type PersonaTopic,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaExpireResult, PersonaExploreResult, DescriptionCheckResult } from "../../prompts/ceremony/types.js";
import type {
  PersonaTopicScanResult,
  PersonaTopicScanCandidate,
  PersonaTopicMatchResult,
  PersonaTopicUpdateResult,
} from "../../prompts/persona/types.js";
import {
  queueExplorePhase,
  queueDescriptionCheck,
  queuePersonaTopicMatch,
  queuePersonaTopicUpdate,
  type PersonaTopicContext,
} from "../orchestrators/index.js";
import { buildPersonaDescriptionsPrompt } from "../../prompts/generation/index.js";
import { splitMessagesByTimestamp } from "./utils.js";

export const MIN_MESSAGE_COUNT_FOR_CREATE = 2;

export function handlePersonaExpire(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaExpire] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaExpireResult | undefined;
  const persona = state.persona_getById(personaId);
  
  if (!persona) {
    console.error(`[handlePersonaExpire] Persona not found: ${personaDisplayName}`);
    return;
  }

  const idsToRemove = new Set(result?.topic_ids_to_remove ?? []);
  const remainingTopics = persona.topics.filter((t: PersonaTopic) => !idsToRemove.has(t.id));
  const removedCount = persona.topics.length - remainingTopics.length;

  if (removedCount > 0) {
    state.persona_update(personaId, { 
      topics: remainingTopics,
      last_updated: new Date().toISOString(),
    });
    console.log(`[handlePersonaExpire] Removed ${removedCount} topic(s) from ${personaDisplayName}`);
  } else {
    console.log(`[handlePersonaExpire] No topics removed for ${personaDisplayName}`);
  }

  const human = state.getHuman();
  const exploreThreshold = human.settings?.ceremony?.explore_threshold ?? 3;

  if (remainingTopics.length < exploreThreshold) {
    console.log(`[handlePersonaExpire] ${personaDisplayName} has ${remainingTopics.length} topic(s) (< ${exploreThreshold}), triggering Explore`);
    queueExplorePhase(personaId, state);
  } else {
    queueDescriptionCheck(personaId, state);
  }
}

export function handlePersonaExplore(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaExplore] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaExploreResult | undefined;
  const persona = state.persona_getById(personaId);

  if (!persona) {
    console.error(`[handlePersonaExplore] Persona not found: ${personaDisplayName}`);
    queueDescriptionCheck(personaId, state);
    return;
  }

  const newTopics = result?.new_topics ?? [];
  if (newTopics.length === 0) {
    console.log(`[handlePersonaExplore] No new topics generated for ${personaDisplayName}`);
    queueDescriptionCheck(personaId, state);
    return;
  }

  const now = new Date().toISOString();
  const existingNames = new Set(persona.topics.map((t: PersonaTopic) => t.name.toLowerCase()));

  const topicsToAdd: PersonaTopic[] = newTopics
    .filter(t => !existingNames.has(t.name.toLowerCase()))
    .map(t => ({
      id: crypto.randomUUID(),
      name: t.name,
      perspective: t.perspective || "",
      approach: t.approach || "",
      personal_stake: t.personal_stake || "",
      sentiment: t.sentiment,
      exposure_current: t.exposure_current ?? 0.2,
      exposure_desired: t.exposure_desired ?? 0.6,
      last_updated: now,
    }));

  if (topicsToAdd.length > 0) {
    const allTopics = [...persona.topics, ...topicsToAdd];
    state.persona_update(personaId, { 
      topics: allTopics,
      last_updated: now,
    });
    console.log(`[handlePersonaExplore] Added ${topicsToAdd.length} new topic(s) to ${personaDisplayName}: ${topicsToAdd.map(t => t.name).join(", ")}`);
  }

  queueDescriptionCheck(personaId, state);
}

export function handleDescriptionCheck(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handleDescriptionCheck] No personaId in request data");
    return;
  }

  const result = response.parsed as DescriptionCheckResult | undefined;
  if (!result) {
    console.error("[handleDescriptionCheck] No parsed result");
    return;
  }

  console.log(`[handleDescriptionCheck] ${personaDisplayName}: ${result.should_update ? "UPDATE NEEDED" : "No update needed"} - ${result.reason ?? "no reason given"}`);

  if (!result.should_update) {
    console.log(`[handleDescriptionCheck] Ceremony complete for ${personaDisplayName}`);
    return;
  }

  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[handleDescriptionCheck] Persona not found: ${personaDisplayName}`);
    return;
  }

  const prompt = buildPersonaDescriptionsPrompt({
    name: persona.display_name,
    aliases: persona.aliases ?? [],
    traits: persona.traits,
    topics: persona.topics,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaDescriptions,
    data: { personaId, personaDisplayName },
  });

  console.log(`[handleDescriptionCheck] Queued description regeneration for ${personaDisplayName}`);
}

export function handlePersonaTopicScan(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId || !personaDisplayName) {
    console.error("[handlePersonaTopicScan] Missing personaId or personaDisplayName in request data");
    return;
  }

  const result = response.parsed as PersonaTopicScanResult | undefined;
  if (!result?.topics || !Array.isArray(result.topics)) {
    console.log("[handlePersonaTopicScan] No topics detected or invalid result");
    return;
  }

  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  const allMessages = state.messages_get(personaId);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);

  const context: PersonaTopicContext = {
    personaId,
    personaDisplayName,
    messages_context,
    messages_analyze,
  };

  for (const candidate of result.topics) {
    queuePersonaTopicMatch(candidate, context, state);
  }
  console.log(`[handlePersonaTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

export function handlePersonaTopicMatch(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const candidate = response.request.data.candidate as PersonaTopicScanCandidate;
  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;

  if (!personaId || !personaDisplayName || !candidate) {
    console.error("[handlePersonaTopicMatch] Missing required data");
    return;
  }

  const result = response.parsed as PersonaTopicMatchResult | undefined;
  if (!result) {
    console.error("[handlePersonaTopicMatch] No parsed result");
    return;
  }

  if (result.action === "match") {
    console.log(`[handlePersonaTopicMatch] "${candidate.name}" matched existing topic`);
  } else if (result.action === "create") {
    if (candidate.message_count < MIN_MESSAGE_COUNT_FOR_CREATE) {
      console.log(`[handlePersonaTopicMatch] "${candidate.name}" skipped: message_count ${candidate.message_count} < ${MIN_MESSAGE_COUNT_FOR_CREATE}`);
      return;
    }
    console.log(`[handlePersonaTopicMatch] "${candidate.name}" will be created`);
  } else if (result.action === "skip") {
    console.log(`[handlePersonaTopicMatch] "${candidate.name}" skipped: ${result.reason}`);
    return;
  }

  const allMessages = state.messages_get(personaId);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);

  const context: PersonaTopicContext = {
    personaId,
    personaDisplayName,
    messages_context,
    messages_analyze,
  };

  queuePersonaTopicUpdate(candidate, result, context, state);
}

export function handlePersonaTopicUpdate(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const existingTopicId = response.request.data.existingTopicId as string | null;
  const isNewTopic = response.request.data.isNewTopic as boolean;

  if (!personaId) {
    console.error("[handlePersonaTopicUpdate] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaTopicUpdateResult | undefined;
  if (!result) {
    console.error("[handlePersonaTopicUpdate] No parsed result");
    return;
  }

  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[handlePersonaTopicUpdate] Persona not found: ${personaDisplayName}`);
    return;
  }

  const now = new Date().toISOString();

  if (isNewTopic) {
    const newTopic: PersonaTopic = {
      id: crypto.randomUUID(),
      name: result.name,
      perspective: result.perspective || "",
      approach: result.approach || "",
      personal_stake: result.personal_stake || "",
      sentiment: result.sentiment,
      exposure_current: result.exposure_current,
      exposure_desired: result.exposure_desired,
      last_updated: now,
    };

    const allTopics = [...persona.topics, newTopic];
    state.persona_update(personaId, { topics: allTopics, last_updated: now });
    console.log(`[handlePersonaTopicUpdate] Created new topic "${result.name}" for ${personaDisplayName}`);
  } else if (existingTopicId) {
    const updatedTopics = persona.topics.map((t: PersonaTopic) => {
      if (t.id !== existingTopicId) return t;

      const newExposure = Math.min(1.0, t.exposure_current + (result.exposure_current - t.exposure_current));

      return {
        ...t,
        name: result.name,
        perspective: result.perspective || t.perspective,
        approach: result.approach || t.approach,
        personal_stake: result.personal_stake || t.personal_stake,
        sentiment: result.sentiment,
        exposure_current: newExposure,
        exposure_desired: result.exposure_desired,
        last_updated: now,
      };
    });

    state.persona_update(personaId, { topics: updatedTopics, last_updated: now });
    console.log(`[handlePersonaTopicUpdate] Updated topic "${result.name}" for ${personaDisplayName}`);
  }
}
