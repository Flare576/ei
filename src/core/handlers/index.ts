import { 
  ContextStatus, 
  LLMNextStep, 
  type LLMResponse, 
  type Message, 
  type Trait, 
  type Topic,
  type Fact,
  type Person,
  type DataItemType,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { HeartbeatCheckResult, EiHeartbeatResult } from "../../prompts/heartbeat/types.js";
import type { PersonaGenerationResult, PersonaDescriptionsResult } from "../../prompts/generation/types.js";
import type { TraitResult, TopicResult } from "../../prompts/persona/types.js";
import type { EiValidationResult } from "../../prompts/validation/types.js";
import { 
  orchestratePersonaGeneration, 
  queueItemMatch, 
  queueItemUpdate,
  type PartialPersona,
  type ExtractionContext,
} from "../orchestrators/index.js";
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

  const topics: Topic[] = (result?.topics || []).map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    exposure_current: t.exposure_current,
    exposure_desired: t.exposure_desired,
    last_updated: now,
  }));

  const updatedPartial: PartialPersona = {
    ...existingPartial,
    short_description: result?.short_description ?? existingPartial.short_description,
    long_description: result?.long_description ?? existingPartial.long_description,
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

function handlePersonaTopicDetection(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaTopicDetection] No personaName in request data");
    return;
  }

  const result = response.parsed as TopicResult[] | undefined;
  if (!result || !Array.isArray(result)) {
    console.error("[handlePersonaTopicDetection] Invalid parsed result");
    return;
  }

  const now = new Date().toISOString();
  const topics: Topic[] = result.map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    exposure_current: t.exposure_current,
    exposure_desired: t.exposure_desired,
    last_updated: now,
  }));

  state.persona_update(personaName, { topics, last_updated: now });
  console.log(`[handlePersonaTopicDetection] Updated ${topics.length} topics for ${personaName}`);
}

function handlePersonaTopicExploration(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaTopicExploration] No personaName in request data");
    return;
  }

  const result = response.parsed as TopicResult[] | undefined;
  if (!result || !Array.isArray(result)) {
    console.error("[handlePersonaTopicExploration] Invalid parsed result");
    return;
  }

  if (result.length === 0) {
    console.log(`[handlePersonaTopicExploration] No new topics for ${personaName}`);
    return;
  }

  const persona = state.persona_get(personaName);
  if (!persona) {
    console.error(`[handlePersonaTopicExploration] Persona not found: ${personaName}`);
    return;
  }

  const now = new Date().toISOString();
  const existingNames = new Set(persona.topics.map(t => t.name.toLowerCase()));
  
  const newTopics: Topic[] = result
    .filter(t => !existingNames.has(t.name.toLowerCase()))
    .map(t => ({
      id: crypto.randomUUID(),
      name: t.name,
      description: t.description,
      sentiment: t.sentiment,
      exposure_current: t.exposure_current,
      exposure_desired: t.exposure_desired,
      last_updated: now,
    }));

  if (newTopics.length > 0) {
    const allTopics = [...persona.topics, ...newTopics];
    state.persona_update(personaName, { topics: allTopics, last_updated: now });
    console.log(`[handlePersonaTopicExploration] Added ${newTopics.length} new topics for ${personaName}`);
  }
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
        state.human_fact_upsert(item as any);
        break;
      case "trait":
        state.human_trait_upsert(item as any);
        break;
      case "topic":
        state.human_topic_upsert(item as any);
        break;
      case "person":
        state.human_person_upsert(item as any);
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
  console.log("[handleCeremonyExposure] Stub - will be implemented in Wave 3");
}

function handleCeremonyDecayComplete(_response: LLMResponse, _state: StateManager): void {
  console.log("[handleCeremonyDecayComplete] Stub - will be implemented in Wave 3");
}

function handlePersonaExpire(_response: LLMResponse, _state: StateManager): void {
  console.log("[handlePersonaExpire] Stub - will be implemented in Wave 3");
}

function handlePersonaExplore(_response: LLMResponse, _state: StateManager): void {
  console.log("[handlePersonaExplore] Stub - will be implemented in Wave 3");
}

function handleDescriptionCheck(_response: LLMResponse, _state: StateManager): void {
  console.log("[handleDescriptionCheck] Stub - will be implemented in Wave 3");
}

function handleHumanFactScan(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as FactScanResult | undefined;
  if (!result?.facts || !Array.isArray(result.facts)) {
    console.log("[handleHumanFactScan] No facts detected or invalid result");
    return;
  }

  const context = extractContext(response);
  if (!context) return;

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

  const context = extractContext(response);
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

  const context = extractContext(response);
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

  const context = extractContext(response);
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

  const dataType = response.request.data.dataType as DataItemType;
  const itemName = response.request.data.itemName as string;
  const itemValue = response.request.data.itemValue as string;
  const scanConfidence = response.request.data.scanConfidence as string;
  const personaName = response.request.data.personaName as string;
  const messages_context = response.request.data.messages_context as Message[];
  const messages_analyze = response.request.data.messages_analyze as Message[];

  const context: ExtractionContext & { itemName: string; itemValue: string; scanConfidence: string } = {
    personaName,
    messages_context,
    messages_analyze,
    itemName,
    itemValue,
    scanConfidence,
  };

  queueItemUpdate(dataType, result, context, state);
  const matched = result.name !== "Not Found" ? `matched "${result.name}"` : "no match (new item)";
  console.log(`[handleHumanItemMatch] ${dataType} "${itemName}": ${matched}`);
}

function handleHumanItemUpdate(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemUpdateResult | undefined;
  
  if (!result || Object.keys(result).length === 0) {
    console.log("[handleHumanItemUpdate] No changes needed (empty result)");
    return;
  }

  const dataType = response.request.data.dataType as DataItemType;
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

  switch (dataType) {
    case "fact": {
      const fact: Fact = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        confidence: (result as any).confidence ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaName : undefined,
        persona_groups: isNewItem && personaGroup ? [personaGroup] : undefined,
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
        learned_by: isNewItem ? personaName : undefined,
        persona_groups: isNewItem && personaGroup ? [personaGroup] : undefined,
      };
      applyOrValidate(state, "trait", trait, personaName, isEi, personaGroup);
      break;
    }
    case "topic": {
      const exposureImpact = (result as any).exposure_impact as ExposureImpact | undefined;
      const topic: Topic = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        exposure_current: calculateExposureCurrent(exposureImpact),
        exposure_desired: (result as any).exposure_desired ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaName : undefined,
        persona_groups: isNewItem && personaGroup ? [personaGroup] : undefined,
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
        learned_by: isNewItem ? personaName : undefined,
        persona_groups: isNewItem && personaGroup ? [personaGroup] : undefined,
      };
      applyOrValidate(state, "person", person, personaName, isEi, personaGroup);
      break;
    }
  }

  console.log(`[handleHumanItemUpdate] ${isNewItem ? "Created" : "Updated"} ${dataType} "${result.name}"`);
}

function extractContext(response: LLMResponse): ExtractionContext | null {
  const personaName = response.request.data.personaName as string;
  const messages_context = response.request.data.messages_context as Message[] | undefined;
  const messages_analyze = response.request.data.messages_analyze as Message[] | undefined;

  if (!personaName || !messages_context || !messages_analyze) {
    console.error("[extractContext] Missing required context in request data");
    return null;
  }

  return { personaName, messages_context, messages_analyze };
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

  const scanConfidence = (item as any).confidence ?? 0.5;
  const priority = scanConfidence > 0.7 
    ? LLMPriority.Low 
    : scanConfidence > 0.4 
      ? LLMPriority.Normal 
      : LLMPriority.High;

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
  handlePersonaTopicDetection,
  handlePersonaTopicExploration,
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
