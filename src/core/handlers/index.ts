import {
  ContextStatus,
  LLMNextStep,
  ValidationLevel,
  type LLMResponse,
  type Message,
  type Trait,
  type Topic,
  type PersonaTopic,
  type Fact,
  type Person,
  type Quote,
  type DataItemType,
  type DataItemBase,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { HeartbeatCheckResult, EiHeartbeatResult } from "../../prompts/heartbeat/types.js";
import type { PersonaGenerationResult, PersonaDescriptionsResult } from "../../prompts/generation/types.js";
import type { 
  TraitResult,
  PersonaTopicScanResult,
  PersonaTopicScanCandidate,
  PersonaTopicMatchResult,
  PersonaTopicUpdateResult,
} from "../../prompts/persona/types.js";
import type { PersonaResponseResult } from "../../prompts/response/index.js";

import type { 
  PersonaExpireResult, 
  PersonaExploreResult,
  DescriptionCheckResult,
} from "../../prompts/ceremony/types.js";
import { 
  orchestratePersonaGeneration, 
  queueItemMatch, 
  queueItemUpdate,
  queueExplorePhase,
  queueDescriptionCheck,
  queuePersonaTopicMatch,
  queuePersonaTopicUpdate,
  type PartialPersona,
  type ExtractionContext,
  type PersonaTopicContext,
} from "../orchestrators/index.js";
import { buildPersonaDescriptionsPrompt } from "../../prompts/generation/index.js";
import type {
  FactScanResult,
  TraitScanResult,
  TopicScanResult,
  PersonScanResult,
  ItemMatchResult,
  ItemUpdateResult,
  ExposureImpact,
} from "../../prompts/human/types.js";

import { LLMRequestType, LLMPriority } from "../types.js";
import { getEmbeddingService, getItemEmbeddingText } from "../embedding-service.js";
import { crossFind } from "../utils/index.js";

export type ResponseHandler = (response: LLMResponse, state: StateManager) => void | Promise<void>;

function splitMessagesByTimestamp(
  messages: Message[], 
  analyzeFromTimestamp: string | null
): { messages_context: Message[]; messages_analyze: Message[] } {
  if (!analyzeFromTimestamp) {
    return { messages_context: [], messages_analyze: messages };
  }
  const splitTime = new Date(analyzeFromTimestamp).getTime();
  const splitIndex = messages.findIndex(m => new Date(m.timestamp).getTime() >= splitTime);
  if (splitIndex === -1) {
    return { messages_context: messages, messages_analyze: [] };
  }
  return {
    messages_context: messages.slice(0, splitIndex),
    messages_analyze: messages.slice(splitIndex),
  };
}

type ExtractionFlag = "f" | "r" | "p" | "o";

function markMessagesExtracted(
  response: LLMResponse, 
  state: StateManager, 
  flag: ExtractionFlag
): void {
  const personaId = response.request.data.personaId as string | undefined;
  const messageIds = response.request.data.message_ids_to_mark as string[] | undefined;
  
  if (!personaId || !messageIds?.length) return;
  
  const count = state.messages_markExtracted(personaId, messageIds, flag);
  if (count > 0) {
    console.log(`[markMessagesExtracted] Marked ${count} messages with flag '${flag}' for persona ${personaId}`);
  }
}

function handlePersonaResponse(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaResponse] No personaId in request data");
    return;
  }

  // Always mark user messages as read - even if persona chooses not to respond,
  // the messages were "seen" and processed
  state.messages_markPendingAsRead(personaId);

  // Structured JSON path: queue-processor parsed valid JSON into `parsed`
  if (response.parsed !== undefined) {
    const result = response.parsed as PersonaResponseResult;

    if (!result.should_respond) {
      const reason = result.reason;
      if (reason) {
        console.log(`[handlePersonaResponse] ${personaDisplayName} chose silence: ${reason}`);
        const silentMessage: Message = {
          id: crypto.randomUUID(),
          role: "system",
          silence_reason: reason,
          timestamp: new Date().toISOString(),
          read: false,
          context_status: ContextStatus.Never,
        };
        state.messages_append(personaId, silentMessage);
      } else {
        console.log(`[handlePersonaResponse] ${personaDisplayName} chose not to respond (no reason given)`);
      }
      return;
    }

    // Build message with structured fields
    const verbal = result.verbal_response || undefined;
    const action = result.action_response || undefined;

    if (!verbal && !action) {
      console.log(`[handlePersonaResponse] ${personaDisplayName} JSON had should_respond=true but no content fields`);
      return;
    }

    const message: Message = {
      id: crypto.randomUUID(),
      role: "system",
      verbal_response: verbal,
      action_response: action,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: ContextStatus.Default,
    };
    state.messages_append(personaId, message);
    console.log(`[handlePersonaResponse] Appended structured response to ${personaDisplayName}`);
    return;
  }

  // Legacy plain-text fallback
  if (!response.content) {
    console.log(`[handlePersonaResponse] ${personaDisplayName} chose not to respond (no reason given)`);
    return;
  }

  const message: Message = {
    id: crypto.randomUUID(),
    role: "system",
    verbal_response: response.content ?? undefined,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };
  state.messages_append(personaId, message);
  console.log(`[handlePersonaResponse] Appended response to ${personaDisplayName}`);
}

function handleHeartbeatCheck(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handleHeartbeatCheck] No personaId in request data");
    return;
  }

  const result = response.parsed as HeartbeatCheckResult | undefined;
  if (!result) {
    console.error("[handleHeartbeatCheck] No parsed result");
    return;
  }

  const now = new Date().toISOString();
  state.persona_update(personaId, { last_heartbeat: now });

  if (!result.should_respond) {
    console.log(`[handleHeartbeatCheck] ${personaDisplayName} chose not to reach out`);
    return;
  }

  if (result.message) {
    const message: Message = {
      id: crypto.randomUUID(),
      role: "system",
      verbal_response: result.message,
      timestamp: now,
      read: false,
      context_status: ContextStatus.Default,
    };
    state.messages_append(personaId, message);
    console.log(`[handleHeartbeatCheck] ${personaDisplayName} proactively messaged about: ${result.topic ?? "general"}`);
  }
}

function handleEiHeartbeat(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as EiHeartbeatResult | undefined;
  if (!result) {
    console.error("[handleEiHeartbeat] No parsed result");
    return;
  }
  const now = new Date().toISOString();
  state.persona_update("ei", { last_heartbeat: now });
  if (!result.should_respond || !result.id) {
    console.log("[handleEiHeartbeat] Ei chose not to reach out");
    return;
  }
  const isTUI = response.request.data.isTUI as boolean;
  const found = crossFind(result.id, state.getHuman(), state.persona_getAll());
  if (!found) {
    console.warn(`[handleEiHeartbeat] Could not find item with id "${result.id}"`);
    return;
  }

  const sendMessage = (verbal_response: string) => state.messages_append("ei", {
    id: crypto.randomUUID(),
    role: "system",
    verbal_response,
    timestamp: now,
    read: false,
    context_status: ContextStatus.Default,
  });

  if (found.type === "fact") {
    const factsNav = isTUI ? "using /me facts" : "using \u2630 \u2192 My Data";
    sendMessage(`Another persona updated a fact called "${found.name}" to "${found.description}". If that's right, you can lock it from further changes by ${factsNav}.`);
    state.human_fact_upsert({ ...found, validated: ValidationLevel.Ei, validated_date: now });
    console.log(`[handleEiHeartbeat] Notified about fact "${found.name}"`);
    return;
  }

  if (result.my_response) sendMessage(result.my_response);

  switch (found.type) {
    case "person":
      state.human_person_upsert({ ...found, last_ei_asked: now });
      console.log(`[handleEiHeartbeat] Reached out about person "${found.name}"`);
      break;
    case "topic":
      state.human_topic_upsert({ ...found, last_ei_asked: now });
      console.log(`[handleEiHeartbeat] Reached out about topic "${found.name}"`);
      break;
    case "persona":
      console.log(`[handleEiHeartbeat] Reached out about persona "${found.display_name}"`);
      break;
    default:
      console.warn(`[handleEiHeartbeat] Unexpected item type "${found.type}" for id "${result.id}"`);
  }
}

function handlePersonaGeneration(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaGeneration] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaGenerationResult | undefined;
  const existingPartial = (response.request.data.partial as PartialPersona) ?? { id: personaId, name: personaDisplayName };

  const now = new Date().toISOString();

  const traits: Trait[] = (result?.traits || []).map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    strength: t.strength,
    last_updated: now,
  }));

  const topics: PersonaTopic[] = (result?.topics || []).map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    perspective: t.perspective || "",
    approach: t.approach || "",
    personal_stake: t.personal_stake || "",
    sentiment: t.sentiment,
    exposure_current: t.exposure_current,
    exposure_desired: t.exposure_desired,
    last_updated: now,
  }));

  const updatedPartial: PartialPersona = {
    ...existingPartial,
    short_description: result?.short_description ?? existingPartial.short_description,
    long_description: existingPartial.long_description ?? result?.long_description,
    traits: traits.length > 0 ? traits : existingPartial.traits,
    topics: topics.length > 0 ? topics : existingPartial.topics,
  };

  orchestratePersonaGeneration(updatedPartial, state);
  console.log(`[handlePersonaGeneration] Orchestrated: ${personaDisplayName}`);
}

function handlePersonaDescriptions(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaDescriptions] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaDescriptionsResult | undefined;
  if (!result) {
    console.error("[handlePersonaDescriptions] No parsed result");
    return;
  }

  if (result.no_change) {
    console.log(`[handlePersonaDescriptions] No change needed for ${personaDisplayName}`);
    return;
  }

  state.persona_update(personaId, {
    short_description: result.short_description,
    long_description: result.long_description,
    last_updated: new Date().toISOString(),
  });
  console.log(`[handlePersonaDescriptions] Updated descriptions for ${personaDisplayName}`);
}

function handlePersonaTraitExtraction(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaTraitExtraction] No personaId in request data");
    return;
  }

  const result = response.parsed as TraitResult[] | undefined;
  if (!result || !Array.isArray(result)) {
    console.error("[handlePersonaTraitExtraction] Invalid parsed result");
    return;
  }

  const now = new Date().toISOString();
  const traits: Trait[] = result.map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    strength: t.strength,
    last_updated: now,
  }));

  state.persona_update(personaId, { traits, last_updated: now });
  console.log(`[handlePersonaTraitExtraction] Updated ${traits.length} traits for ${personaDisplayName}`);
}



function handleOneShot(_response: LLMResponse, _state: StateManager): void {
  // One-shot is handled specially in Processor to fire onOneShotReturned
  // This handler is a no-op placeholder
}

function handlePersonaExpire(response: LLMResponse, state: StateManager): void {
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

function handlePersonaExplore(response: LLMResponse, state: StateManager): void {
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

function handleDescriptionCheck(response: LLMResponse, state: StateManager): void {
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

async function handleHumanFactScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as FactScanResult | undefined;
  
  // Mark messages as scanned regardless of whether facts were found
  markMessagesExtracted(response, state, "f");
  
  if (!result?.facts || !Array.isArray(result.facts)) {
    console.log("[handleHumanFactScan] No facts detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.facts) {
    await queueItemMatch("fact", candidate, context, state);
  }
  console.log(`[handleHumanFactScan] Queued ${result.facts.length} fact(s) for matching`);
}

async function handleHumanTraitScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as TraitScanResult | undefined;
  
  markMessagesExtracted(response, state, "r");
  
  if (!result?.traits || !Array.isArray(result.traits)) {
    console.log("[handleHumanTraitScan] No traits detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.traits) {
    await queueItemMatch("trait", candidate, context, state);
  }
  console.log(`[handleHumanTraitScan] Queued ${result.traits.length} trait(s) for matching`);
}

async function handleHumanTopicScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as TopicScanResult | undefined;
  
  markMessagesExtracted(response, state, "p");
  
  if (!result?.topics || !Array.isArray(result.topics)) {
    console.log("[handleHumanTopicScan] No topics detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.topics) {
    await queueItemMatch("topic", candidate, context, state);
  }
  console.log(`[handleHumanTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

async function handleHumanPersonScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as PersonScanResult | undefined;
  
  markMessagesExtracted(response, state, "o");
  
  if (!result?.people || !Array.isArray(result.people)) {
    console.log("[handleHumanPersonScan] No people detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.people) {
    await queueItemMatch("person", candidate, context, state);
  }
  console.log(`[handleHumanPersonScan] Queued ${result.people.length} person(s) for matching`);
}

function handleHumanItemMatch(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemMatchResult | undefined;
  if (!result) {
    console.error("[handleHumanItemMatch] No parsed result");
    return;
  }

  const candidateType = response.request.data.candidateType as DataItemType;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  const allMessages = state.messages_get(personaId);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);
  const context: ExtractionContext & { itemName: string; itemValue: string; itemCategory?: string } = {
    personaId,
    personaDisplayName,
    messages_context,
    messages_analyze,
    itemName: response.request.data.itemName as string,
    itemValue: response.request.data.itemValue as string,
    itemCategory: response.request.data.itemCategory as string | undefined,
  };

  let resolvedType: DataItemType = candidateType;
  let matched_guid = result.matched_guid;
  if (matched_guid === "new") {
    matched_guid = null;
  } else if (matched_guid) {
    const found = crossFind(matched_guid, state.getHuman());
    if (!found) {
      console.warn(`[handleHumanItemMatch] matched_guid "${matched_guid}" not found in human data — treating as new item`);
      matched_guid = null;
    } else if (found.type === "fact" && found.validated === ValidationLevel.Human) {
      console.log(`[handleHumanItemMatch] Skipping locked fact "${found.name}" (human-validated)`);
      return;
    } else if (!(found.type === "fact" || found.type === "trait" || found.type === "topic" || found.type === "person")) {
      console.warn(`[handleHumanItemMatch] matched_guid "${matched_guid}" resolved to non-human type "${found.type}" - Ignoring`);
      return;
    } else {
      resolvedType = found.type;
      context.itemName = found.name || context.itemName;
      context.itemValue = found.description || context.itemValue;
    }
  }
  result.matched_guid = matched_guid;
  queueItemUpdate(resolvedType, result, context, state);
  const matched = matched_guid ? `matched GUID "${matched_guid}"` : "no match (new item)";
  console.log(`[handleHumanItemMatch] ${resolvedType} "${context.itemName}": ${matched}`);
}

async function handleHumanItemUpdate(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as ItemUpdateResult | undefined;
  
  if (!result || Object.keys(result).length === 0) {
    console.log("[handleHumanItemUpdate] No changes needed (empty result)");
    return;
  }

  const candidateType = response.request.data.candidateType as DataItemType;
  const isNewItem = response.request.data.isNewItem as boolean;
  const existingItemId = response.request.data.existingItemId as string | undefined;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;

  if (!result.name || !result.description || result.sentiment === undefined) {
    console.error("[handleHumanItemUpdate] Missing required fields in result");
    return;
  }

  const now = new Date().toISOString();
  const resolveItemId = (): string => {
    if (isNewItem || !existingItemId) return crypto.randomUUID();
    const h = state.getHuman();
    const arr = candidateType === "fact" ? h.facts : candidateType === "trait" ? h.traits : candidateType === "topic" ? h.topics : h.people;
    // Guard: if existingItemId isn't in the correct type array, treat as new
    // (prevents cross-type ID reuse when LLM matches against a different type's UUID)
    return arr.find((x: DataItemBase) => x.id === existingItemId) ? existingItemId : crypto.randomUUID();
  };
  const itemId = resolveItemId();

  const persona = state.persona_getById(personaId);
  const personaGroup = persona?.group_primary ?? null;
  const isEi = personaDisplayName.toLowerCase() === "ei";

  const human = state.getHuman();
  const getExistingItem = (): { learned_by?: string; persona_groups?: string[] } | undefined => {
    if (isNewItem) return undefined;
    switch (candidateType) {
      case "fact": return human.facts.find(f => f.id === existingItemId);
      case "trait": return human.traits.find(t => t.id === existingItemId);
      case "topic": return human.topics.find(t => t.id === existingItemId);
      case "person": return human.people.find(p => p.id === existingItemId);
    }
  };
  const existingItem = getExistingItem();

  const mergeGroups = (existing: string[] | undefined): string[] | undefined => {
    if (!personaGroup) return existing;
    if (isNewItem) return [personaGroup];
    const groups = new Set(existing ?? []);
    groups.add(personaGroup);
    return Array.from(groups);
  };

  let embedding: number[] | undefined;
  try {
    const embeddingService = getEmbeddingService();
    const text = getItemEmbeddingText({ name: result.name, description: result.description });
    embedding = await embeddingService.embed(text);
  } catch (err) {
    console.warn(`[handleHumanItemUpdate] Failed to compute embedding for ${candidateType} "${result.name}":`, err);
  }

  switch (candidateType) {
    case "fact": {
      const fact: Fact = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        validated: ValidationLevel.None,
        validated_date: now,
        last_updated: now,
        learned_by: isNewItem ? personaDisplayName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "fact", fact, personaDisplayName, isEi, personaGroup);
      break;
    }
    case "trait": {
      const trait: Trait = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        strength: (result as any).strength ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaDisplayName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "trait", trait, personaDisplayName, isEi, personaGroup);
      break;
    }
    case "topic": {
      const exposureImpact = (result as any).exposure_impact as ExposureImpact | undefined;
      const itemCategory = response.request.data.itemCategory as string | undefined;
      const existingTopic = human.topics.find(t => t.id === existingItemId);
      const topic: Topic = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        category: (result as any).category ?? itemCategory ?? existingTopic?.category,
        exposure_current: calculateExposureCurrent(exposureImpact),
        exposure_desired: (result as any).exposure_desired ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaDisplayName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "topic", topic, personaDisplayName, isEi, personaGroup);
      break;
    }
    case "person": {
      const exposureImpact = (result as any).exposure_impact as ExposureImpact | undefined;
      const person: Person = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        relationship: (result as any).relationship ?? "Unknown",
        exposure_current: calculateExposureCurrent(exposureImpact),
        exposure_desired: (result as any).exposure_desired ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaDisplayName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "person", person, personaDisplayName, isEi, personaGroup);
      break;
    }
  }

  const allMessages = state.messages_get(personaId);
  await validateAndStoreQuotes(result.quotes, allMessages, itemId, personaDisplayName, personaGroup, state);

  console.log(`[handleHumanItemUpdate] ${isNewItem ? "Created" : "Updated"} ${candidateType} "${result.name}"`);
}

/**
 * Returns the combined display text of a message for quote indexing.
 * Mirrors the rendering logic used in the frontends.
 */
function getMessageText(message: Message): string {
  const parts: string[] = [];
  if (message.action_response) parts.push(`_${message.action_response}_`);
  if (message.verbal_response) parts.push(message.verbal_response);
  return parts.join('\n\n');
}


async function validateAndStoreQuotes(
  candidates: Array<{ text: string; reason: string }> | undefined,
  messages: Message[],
  dataItemId: string,
  personaName: string,
  personaGroup: string | null,
  state: StateManager
): Promise<void> {
  if (!candidates || candidates.length === 0) return;
  
  for (const candidate of candidates) {
    let found = false;
    for (const message of messages) {
      const msgText = getMessageText(message);
      const start = msgText.indexOf(candidate.text);
      if (start !== -1) {
        const end = start + candidate.text.length;
        
        // Check for ANY overlapping quote in this message (not just exact match)
        const existing = state.human_quote_getForMessage(message.id);
        const overlapping = existing.find(q =>
          q.start !== null && q.end !== null &&
          start < q.end && end > q.start  // ranges overlap
        );
        
        if (overlapping) {
          // Merge: expand to the union of both ranges
          const mergedStart = Math.min(start, overlapping.start!);
          const mergedEnd = Math.max(end, overlapping.end!);
          const mergedText = msgText.slice(mergedStart, mergedEnd);
          
          // Merge data_item_ids and persona_groups (deduplicated)
          const mergedDataItemIds = overlapping.data_item_ids.includes(dataItemId)
            ? overlapping.data_item_ids
            : [...overlapping.data_item_ids, dataItemId];
          const group = personaGroup || "General";
          const mergedGroups = overlapping.persona_groups.includes(group)
            ? overlapping.persona_groups
            : [...overlapping.persona_groups, group];
          
          // Only recompute embedding if the text actually changed
          let embedding = overlapping.embedding;
          if (mergedText !== overlapping.text) {
            try {
              const embeddingService = getEmbeddingService();
              embedding = await embeddingService.embed(mergedText);
            } catch (err) {
              console.warn(`[extraction] Failed to recompute embedding for merged quote: "${mergedText.slice(0, 30)}..."`, err);
            }
          }
          
          state.human_quote_update(overlapping.id, {
            start: mergedStart,
            end: mergedEnd,
            text: mergedText,
            data_item_ids: mergedDataItemIds,
            persona_groups: mergedGroups,
            embedding,
          });
          console.log(`[extraction] Merged overlapping quote: "${mergedText.slice(0, 50)}..." (${mergedStart}-${mergedEnd})`);
          found = true;
          break;
        }
        
        let embedding: number[] | undefined;
        try {
          const embeddingService = getEmbeddingService();
          embedding = await embeddingService.embed(candidate.text);
        } catch (err) {
          console.warn(`[extraction] Failed to compute embedding for quote: "${candidate.text.slice(0, 30)}..."`, err);
        }
        
        const quote: Quote = {
          id: crypto.randomUUID(),
          message_id: message.id,
          data_item_ids: [dataItemId],
          persona_groups: [personaGroup || "General"],
          text: candidate.text,
          speaker: message.role === "human" ? "human" : personaName,
          timestamp: message.timestamp,
          start: start,
          end: end,
          created_at: new Date().toISOString(),
          created_by: "extraction",
          embedding,
        };
        state.human_quote_add(quote);
        console.log(`[extraction] Captured quote: "${candidate.text.slice(0, 50)}..."`);
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`[extraction] Quote not found in messages, skipping: "${candidate.text?.slice(0, 50)}..."`);
    }
  }
}

function calculateExposureCurrent(impact: ExposureImpact | undefined): number {
  switch (impact) {
    case "high": return 0.9;
    case "medium": return 0.6;
    case "low": return 0.3;
    case "none": return 0.1;
    default: return 0.5;
  }
}

function applyOrValidate(
  state: StateManager,
  dataType: DataItemType,
  item: Fact | Trait | Topic | Person,
  _personaName: string,
  _isEi: boolean,
  _personaGroup: string | null
): void {
  switch (dataType) {
    case "fact": state.human_fact_upsert(item as Fact); break;
    case "trait": state.human_trait_upsert(item as Trait); break;
    case "topic": state.human_topic_upsert(item as Topic); break;
    case "person": state.human_person_upsert(item as Person); break;
  }
}

const MIN_MESSAGE_COUNT_FOR_CREATE = 2;

function handlePersonaTopicScan(response: LLMResponse, state: StateManager): void {
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

function handlePersonaTopicMatch(response: LLMResponse, state: StateManager): void {
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

function handlePersonaTopicUpdate(response: LLMResponse, state: StateManager): void {
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



export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration,
  handlePersonaDescriptions,
  handleHumanFactScan,
  handleHumanTraitScan,
  handleHumanTopicScan,
  handleHumanPersonScan,
  handleHumanItemMatch,
  handleHumanItemUpdate,
  handlePersonaTraitExtraction,
  handlePersonaTopicScan,
  handlePersonaTopicMatch,
  handlePersonaTopicUpdate,
  handleHeartbeatCheck,
  handleEiHeartbeat,
  handleOneShot,
  handlePersonaExpire,
  handlePersonaExplore,
  handleDescriptionCheck,
};
