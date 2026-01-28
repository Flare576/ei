import { ContextStatus, LLMNextStep, type LLMResponse, type Message, type Trait, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { HeartbeatCheckResult, EiHeartbeatResult } from "../../prompts/heartbeat/types.js";
import type { PersonaGenerationResult, PersonaDescriptionsResult } from "../../prompts/generation/types.js";
import type { TraitResult, TopicResult } from "../../prompts/persona/types.js";
import type { EiValidationResult } from "../../prompts/validation/types.js";
import { orchestratePersonaGeneration, type PartialPersona } from "../orchestrators/index.js";

export type ResponseHandler = (response: LLMResponse, state: StateManager) => void;

function handlePersonaResponse(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaResponse] No personaName in request data");
    return;
  }

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
  state.messages_markPendingAsRead(personaName);
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

export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration,
  handlePersonaDescriptions,
  handleHumanFactScan: stubHandler("handleHumanFactScan"),
  handleHumanTraitScan: stubHandler("handleHumanTraitScan"),
  handleHumanTopicScan: stubHandler("handleHumanTopicScan"),
  handleHumanPersonScan: stubHandler("handleHumanPersonScan"),
  handleHumanItemMatch: stubHandler("handleHumanItemMatch"),
  handleHumanItemUpdate: stubHandler("handleHumanItemUpdate"),
  handlePersonaTraitExtraction,
  handlePersonaTopicDetection,
  handlePersonaTopicExploration,
  handleHeartbeatCheck,
  handleEiHeartbeat,
  handleEiValidation,
  handleOneShot,
};

function stubHandler(name: string): ResponseHandler {
  return (response, _state) => {
    console.log(`[STUB] ${name}:`, response.success ? "success" : "failed");
  };
}
