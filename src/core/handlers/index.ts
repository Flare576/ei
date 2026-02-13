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
import type { EiValidationResult } from "../../prompts/validation/types.js";
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
import { buildEiValidationPrompt } from "../../prompts/validation/index.js";
import { LLMRequestType, LLMPriority, LLMNextStep as NextStep } from "../types.js";

export type ResponseHandler = (response: LLMResponse, state: StateManager) => void;

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

function handlePersonaResponse(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaResponse] No personaName in request data");
    return;
  }

  // Always mark user messages as read - even if persona chooses not to respond,
  // the messages were "seen" and processed
  state.messages_markPendingAsRead(personaName);

  if (!response.content) {
    console.log("[handlePersonaResponse] No content in response (persona chose not to respond)");
    return;
  }

  const message: Message = {
    id: crypto.randomUUID(),
    role: "system",
    content: response.content,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };

  state.messages_append(personaName, message);
  console.log(`[handlePersonaResponse] Appended response to ${personaName}`);
}

function handleHeartbeatCheck(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handleHeartbeatCheck] No personaName in request data");
    return;
  }

  const result = response.parsed as HeartbeatCheckResult | undefined;
  if (!result) {
    console.error("[handleHeartbeatCheck] No parsed result");
    return;
  }

  const now = new Date().toISOString();
  state.persona_update(personaName, { last_heartbeat: now });

  if (!result.should_respond) {
    console.log(`[handleHeartbeatCheck] ${personaName} chose not to reach out`);
    return;
  }

  if (result.message) {
    const message: Message = {
      id: crypto.randomUUID(),
      role: "system",
      content: result.message,
      timestamp: now,
      read: false,
      context_status: ContextStatus.Default,
    };
    state.messages_append(personaName, message);
    console.log(`[handleHeartbeatCheck] ${personaName} proactively messaged about: ${result.topic ?? "general"}`);
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

  if (!result.should_respond) {
    console.log("[handleEiHeartbeat] Ei chose not to reach out");
    return;
  }

  if (result.message) {
    const message: Message = {
      id: crypto.randomUUID(),
      role: "system",
      content: result.message,
      timestamp: now,
      read: false,
      context_status: ContextStatus.Default,
    };
    state.messages_append("ei", message);
    console.log("[handleEiHeartbeat] Ei proactively messaged");
    if (result.priorities) {
      console.log("[handleEiHeartbeat] Priorities:", result.priorities.map(p => p.name).join(", "));
    }
  }
}

function handlePersonaGeneration(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaGeneration] No personaName in request data");
    return;
  }

  const result = response.parsed as PersonaGenerationResult | undefined;
  const existingPartial = (response.request.data.partial as PartialPersona) ?? { name: personaName };

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
  console.log(`[handlePersonaGeneration] Orchestrated: ${personaName}`);
}

function handlePersonaDescriptions(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaDescriptions] No personaName in request data");
    return;
  }

  const result = response.parsed as PersonaDescriptionsResult | undefined;
  if (!result) {
    console.error("[handlePersonaDescriptions] No parsed result");
    return;
  }

  if (result.no_change) {
    console.log(`[handlePersonaDescriptions] No change needed for ${personaName}`);
    return;
  }

  state.persona_update(personaName, {
    short_description: result.short_description,
    long_description: result.long_description,
    last_updated: new Date().toISOString(),
  });
  console.log(`[handlePersonaDescriptions] Updated descriptions for ${personaName}`);
}

function handlePersonaTraitExtraction(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaTraitExtraction] No personaName in request data");
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

  state.persona_update(personaName, { traits, last_updated: now });
  console.log(`[handlePersonaTraitExtraction] Updated ${traits.length} traits for ${personaName}`);
}

function handleEiValidation(response: LLMResponse, state: StateManager): void {
  const validationId = response.request.data.validationId as string;
  const dataType = response.request.data.dataType as string;
  const itemName = response.request.data.itemName as string;

  const result = response.parsed as EiValidationResult | undefined;
  if (!result) {
    console.error("[handleEiValidation] No parsed result");
    return;
  }

  console.log(`[handleEiValidation] Decision for ${dataType} "${itemName}": ${result.decision} - ${result.reason}`);

  if (result.decision === "reject") {
    if (validationId) {
      state.queue_clearValidations([validationId]);
    }
    return;
  }

  const itemToApply = result.decision === "modify" && result.modified_item
    ? result.modified_item
    : response.request.data.proposedItem;

  if (itemToApply && dataType) {
    const now = new Date().toISOString();
    const item = { ...itemToApply, last_updated: now };

    switch (dataType) {
      case "fact":
        state.human_fact_upsert({
          ...item,
          validated: ValidationLevel.Ei,
          validated_date: now,
        } as Fact);
        break;
      case "trait":
        state.human_trait_upsert(item as Trait);
        break;
      case "topic":
        state.human_topic_upsert(item as Topic);
        break;
      case "person":
        state.human_person_upsert(item as Person);
        break;
    }
    console.log(`[handleEiValidation] Applied ${result.decision} for ${dataType} "${itemName}"`);
  }

  if (validationId) {
    state.queue_clearValidations([validationId]);
  }
}

function handleOneShot(_response: LLMResponse, _state: StateManager): void {
  // One-shot is handled specially in Processor to fire onOneShotReturned
  // This handler is a no-op placeholder
}

function handleCeremonyExposure(_response: LLMResponse, _state: StateManager): void {
  console.log("[handleCeremonyExposure] No-op - exposure is handled synchronously in orchestrator");
}

function handleCeremonyDecayComplete(_response: LLMResponse, _state: StateManager): void {
  console.log("[handleCeremonyDecayComplete] No-op - decay is handled synchronously in orchestrator");
}

function handlePersonaExpire(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaExpire] No personaName in request data");
    return;
  }

  const result = response.parsed as PersonaExpireResult | undefined;
  const persona = state.persona_get(personaName);
  
  if (!persona) {
    console.error(`[handlePersonaExpire] Persona not found: ${personaName}`);
    return;
  }

  const idsToRemove = new Set(result?.topic_ids_to_remove ?? []);
  const remainingTopics = persona.topics.filter(t => !idsToRemove.has(t.id));
  const removedCount = persona.topics.length - remainingTopics.length;

  if (removedCount > 0) {
    state.persona_update(personaName, { 
      topics: remainingTopics,
      last_updated: new Date().toISOString(),
    });
    console.log(`[handlePersonaExpire] Removed ${removedCount} topic(s) from ${personaName}`);
  } else {
    console.log(`[handlePersonaExpire] No topics removed for ${personaName}`);
  }

  const human = state.getHuman();
  const exploreThreshold = human.ceremony_config?.explore_threshold ?? 3;

  if (remainingTopics.length < exploreThreshold) {
    console.log(`[handlePersonaExpire] ${personaName} has ${remainingTopics.length} topic(s) (< ${exploreThreshold}), triggering Explore`);
    queueExplorePhase(personaName, state);
  } else {
    queueDescriptionCheck(personaName, state);
  }
}

function handlePersonaExplore(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaExplore] No personaName in request data");
    return;
  }

  const result = response.parsed as PersonaExploreResult | undefined;
  const persona = state.persona_get(personaName);

  if (!persona) {
    console.error(`[handlePersonaExplore] Persona not found: ${personaName}`);
    queueDescriptionCheck(personaName, state);
    return;
  }

  const newTopics = result?.new_topics ?? [];
  if (newTopics.length === 0) {
    console.log(`[handlePersonaExplore] No new topics generated for ${personaName}`);
    queueDescriptionCheck(personaName, state);
    return;
  }

  const now = new Date().toISOString();
  const existingNames = new Set(persona.topics.map(t => t.name.toLowerCase()));

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
    state.persona_update(personaName, { 
      topics: allTopics,
      last_updated: now,
    });
    console.log(`[handlePersonaExplore] Added ${topicsToAdd.length} new topic(s) to ${personaName}: ${topicsToAdd.map(t => t.name).join(", ")}`);
  }

  queueDescriptionCheck(personaName, state);
}

function handleDescriptionCheck(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handleDescriptionCheck] No personaName in request data");
    return;
  }

  const result = response.parsed as DescriptionCheckResult | undefined;
  if (!result) {
    console.error("[handleDescriptionCheck] No parsed result");
    return;
  }

  console.log(`[handleDescriptionCheck] ${personaName}: ${result.should_update ? "UPDATE NEEDED" : "No update needed"} - ${result.reason ?? "no reason given"}`);

  if (!result.should_update) {
    console.log(`[handleDescriptionCheck] Ceremony complete for ${personaName}`);
    return;
  }

  const persona = state.persona_get(personaName);
  if (!persona) {
    console.error(`[handleDescriptionCheck] Persona not found: ${personaName}`);
    return;
  }

  const prompt = buildPersonaDescriptionsPrompt({
    name: personaName,
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
    data: { personaName },
  });

  console.log(`[handleDescriptionCheck] Queued description regeneration for ${personaName}`);
}

function handleHumanFactScan(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as FactScanResult | undefined;
  if (!result?.facts || !Array.isArray(result.facts)) {
    console.log("[handleHumanFactScan] No facts detected or invalid result");
    return;
  }

  const context = extractContext(response, state);
  if (!context) return;

  // TODO: we should de-dupe here - We don't need to process "Flare" 2+ times
  for (const candidate of result.facts) {
    queueItemMatch("fact", candidate, context, state);
  }
  console.log(`[handleHumanFactScan] Queued ${result.facts.length} fact(s) for matching`);
}

function handleHumanTraitScan(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as TraitScanResult | undefined;
  if (!result?.traits || !Array.isArray(result.traits)) {
    console.log("[handleHumanTraitScan] No traits detected or invalid result");
    return;
  }

  const context = extractContext(response, state);
  if (!context) return;

  for (const candidate of result.traits) {
    queueItemMatch("trait", candidate, context, state);
  }
  console.log(`[handleHumanTraitScan] Queued ${result.traits.length} trait(s) for matching`);
}

function handleHumanTopicScan(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as TopicScanResult | undefined;
  if (!result?.topics || !Array.isArray(result.topics)) {
    console.log("[handleHumanTopicScan] No topics detected or invalid result");
    return;
  }

  const context = extractContext(response, state);
  if (!context) return;

  for (const candidate of result.topics) {
    queueItemMatch("topic", candidate, context, state);
  }
  console.log(`[handleHumanTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

function handleHumanPersonScan(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as PersonScanResult | undefined;
  if (!result?.people || !Array.isArray(result.people)) {
    console.log("[handleHumanPersonScan] No people detected or invalid result");
    return;
  }

  const context = extractContext(response, state);
  if (!context) return;

  for (const candidate of result.people) {
    queueItemMatch("person", candidate, context, state);
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
  const itemName = response.request.data.itemName as string;
  const itemValue = response.request.data.itemValue as string;
  const personaName = response.request.data.personaName as string;
  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  const includeQuotes = response.request.data.include_quotes as boolean | undefined;
  
  const allMessages = state.messages_get(personaName);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);

  if (result.matched_guid) {
    const human = state.getHuman();
    const matchedFact = human.facts.find(f => f.id === result.matched_guid);
    if (matchedFact?.validated === ValidationLevel.Human) {
      console.log(`[handleHumanItemMatch] Skipping locked fact "${matchedFact.name}" (human-validated)`);
      return;
    }
  }

  const context: ExtractionContext & { itemName: string; itemValue: string; itemCategory?: string } = {
    personaName,
    messages_context,
    messages_analyze,
    itemName,
    itemValue,
    itemCategory: candidateType === "topic" ? itemValue : undefined,
    include_quotes: includeQuotes,
  };

  queueItemUpdate(candidateType, result, context, state);
  const matched = result.matched_guid ? `matched GUID "${result.matched_guid}"` : "no match (new item)";
  console.log(`[handleHumanItemMatch] ${candidateType} "${itemName}": ${matched}`);
}

function handleHumanItemUpdate(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemUpdateResult | undefined;
  
  if (!result || Object.keys(result).length === 0) {
    console.log("[handleHumanItemUpdate] No changes needed (empty result)");
    return;
  }

  const candidateType = response.request.data.candidateType as DataItemType;
  const isNewItem = response.request.data.isNewItem as boolean;
  const existingItemId = response.request.data.existingItemId as string | undefined;
  const personaName = response.request.data.personaName as string;

  if (!result.name || !result.description || result.sentiment === undefined) {
    console.error("[handleHumanItemUpdate] Missing required fields in result");
    return;
  }

  const now = new Date().toISOString();
  const itemId = isNewItem ? crypto.randomUUID() : (existingItemId ?? crypto.randomUUID());

  const persona = state.persona_get(personaName);
  const personaGroup = persona?.group_primary ?? null;
  const isEi = personaName.toLowerCase() === "ei";

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
        learned_by: isNewItem ? personaName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
      };
      applyOrValidate(state, "fact", fact, personaName, isEi, personaGroup);
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
        learned_by: isNewItem ? personaName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
      };
      applyOrValidate(state, "trait", trait, personaName, isEi, personaGroup);
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
        learned_by: isNewItem ? personaName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
      };
      applyOrValidate(state, "topic", topic, personaName, isEi, personaGroup);
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
        learned_by: isNewItem ? personaName : existingItem?.learned_by,
        persona_groups: mergeGroups(existingItem?.persona_groups),
      };
      applyOrValidate(state, "person", person, personaName, isEi, personaGroup);
      break;
    }
  }

  const allMessages = state.messages_get(personaName);
  validateAndStoreQuotes(result.quotes, allMessages, itemId, personaName, personaGroup, state);

  console.log(`[handleHumanItemUpdate] ${isNewItem ? "Created" : "Updated"} ${candidateType} "${result.name}"`);
}

function validateAndStoreQuotes(
  candidates: Array<{ text: string; reason: string }> | undefined,
  messages: Message[],
  dataItemId: string,
  personaName: string,
  personaGroup: string | null,
  state: StateManager
): void {
  if (!candidates || candidates.length === 0) return;
  
  for (const candidate of candidates) {
    // Search all messages for exact match
    let found = false;
    for (const message of messages) {
      const start = message.content.indexOf(candidate.text);
      if (start !== -1) {
        const end = start + candidate.text.length;
        
        // Check for existing quote at same position
        const existing = state.human_quote_getForMessage(message.id);
        const existingQuote = existing.find(q => q.start === start && q.end === end);
        
        if (existingQuote) {
          // Quote exists - append this data item if not already linked
          if (!existingQuote.data_item_ids.includes(dataItemId)) {
            state.human_quote_update(existingQuote.id, {
              data_item_ids: [...existingQuote.data_item_ids, dataItemId],
            });
            console.log(`[extraction] Linked existing quote to "${dataItemId}": "${candidate.text.slice(0, 30)}..."`);
          } else {
            console.log(`[extraction] Quote already linked to "${dataItemId}": "${candidate.text.slice(0, 30)}..."`);
          }
          found = true;
          break;
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
        };
        state.human_quote_add(quote);
        console.log(`[extraction] Captured quote: "${candidate.text.slice(0, 50)}..."`);
        found = true;
        break; // Found it, move to next candidate
      }
    }
    // If loop completes without finding, log it
    if (!found) {
      console.log(`[extraction] Quote not found in messages, skipping: "${candidate.text?.slice(0, 50)}..."`);
    }
  }
}

function extractContext(response: LLMResponse, state: StateManager): ExtractionContext | null {
  const personaName = response.request.data.personaName as string;
  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  const includeQuotes = response.request.data.include_quotes as boolean | undefined;

  if (!personaName) {
    console.error("[extractContext] Missing personaName in request data");
    return null;
  }

  const allMessages = state.messages_get(personaName);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);

  return { personaName, messages_context, messages_analyze, include_quotes: includeQuotes };
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
  personaName: string,
  isEi: boolean,
  personaGroup: string | null
): void {
  const isGeneralGroup = !personaGroup || personaGroup.toLowerCase() === "general";
  const needsValidation = !isEi && isGeneralGroup;

  switch (dataType) {
    case "fact": state.human_fact_upsert(item as Fact); break;
    case "trait": state.human_trait_upsert(item as Trait); break;
    case "topic": state.human_topic_upsert(item as Topic); break;
    case "person": state.human_person_upsert(item as Person); break;
  }

  if (needsValidation) {
    queueEiValidation(state, dataType, item, personaName);
  }
}

const MIN_MESSAGE_COUNT_FOR_CREATE = 2;

function handlePersonaTopicScan(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaTopicScan] No personaName in request data");
    return;
  }

  const result = response.parsed as PersonaTopicScanResult | undefined;
  if (!result?.topics || !Array.isArray(result.topics)) {
    console.log("[handlePersonaTopicScan] No topics detected or invalid result");
    return;
  }

  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  const allMessages = state.messages_get(personaName);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);

  const context: PersonaTopicContext = {
    personaName,
    messages_context,
    messages_analyze,
  };

  for (const candidate of result.topics) {
    queuePersonaTopicMatch(candidate, context, state);
  }
  console.log(`[handlePersonaTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

function handlePersonaTopicMatch(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  const candidate = response.request.data.candidate as PersonaTopicScanCandidate;
  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;

  if (!personaName || !candidate) {
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

  const allMessages = state.messages_get(personaName);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);

  const context: PersonaTopicContext = {
    personaName,
    messages_context,
    messages_analyze,
  };

  queuePersonaTopicUpdate(candidate, result, context, state);
}

function handlePersonaTopicUpdate(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  const existingTopicId = response.request.data.existingTopicId as string | null;
  const isNewTopic = response.request.data.isNewTopic as boolean;

  if (!personaName) {
    console.error("[handlePersonaTopicUpdate] No personaName in request data");
    return;
  }

  const result = response.parsed as PersonaTopicUpdateResult | undefined;
  if (!result) {
    console.error("[handlePersonaTopicUpdate] No parsed result");
    return;
  }

  const persona = state.persona_get(personaName);
  if (!persona) {
    console.error(`[handlePersonaTopicUpdate] Persona not found: ${personaName}`);
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
    state.persona_update(personaName, { topics: allTopics, last_updated: now });
    console.log(`[handlePersonaTopicUpdate] Created new topic "${result.name}" for ${personaName}`);
  } else if (existingTopicId) {
    const updatedTopics = persona.topics.map(t => {
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

    state.persona_update(personaName, { topics: updatedTopics, last_updated: now });
    console.log(`[handlePersonaTopicUpdate] Updated topic "${result.name}" for ${personaName}`);
  }
}

function queueEiValidation(
  state: StateManager,
  dataType: DataItemType,
  item: Fact | Trait | Topic | Person,
  sourcePersona: string
): void {
  const human = state.getHuman();
  let existingItem: Fact | Trait | Topic | Person | undefined;

  switch (dataType) {
    case "fact": existingItem = human.facts.find(f => f.id === item.id); break;
    case "trait": existingItem = human.traits.find(t => t.id === item.id); break;
    case "topic": existingItem = human.topics.find(t => t.id === item.id); break;
    case "person": existingItem = human.people.find(p => p.id === item.id); break;
  }

  const prompt = buildEiValidationPrompt({
    validation_type: "cross_persona",
    item_name: item.name,
    data_type: dataType,
    context: `Learned from conversation with ${sourcePersona}`,
    source_persona: sourcePersona,
    current_item: existingItem,
    proposed_item: item,
  });

  // Cross-persona validation is always normal priority
  const priority = LLMPriority.Normal;

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority,
    system: prompt.system,
    user: prompt.user,
    next_step: NextStep.HandleEiValidation,
    data: {
      validationId: crypto.randomUUID(),
      dataType,
      itemName: item.name,
      proposedItem: item,
      sourcePersona,
    },
  });

  console.log(`[queueEiValidation] Queued ${dataType} "${item.name}" from ${sourcePersona} for Ei validation`);
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
  handleEiValidation,
  handleOneShot,
  handleCeremonyExposure,
  handleCeremonyDecayComplete,
  handlePersonaExpire,
  handlePersonaExplore,
  handleDescriptionCheck,
};
