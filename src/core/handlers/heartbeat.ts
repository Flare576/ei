import {
  ContextStatus,
  LLMNextStep,
  type LLMResponse,
  type Message,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { HeartbeatCheckResult, EiHeartbeatResult } from "../../prompts/heartbeat/types.js";
import type { ReflectionCriticResult } from "../../prompts/reflection/types.js";
import { crossFind } from "../utils/index.js";

export function handleHeartbeatCheck(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handleHeartbeatCheck] No personaId in request data");
    return;
  }

  const result = response.parsed as HeartbeatCheckResult | undefined;
  if (!result) {
    console.error(`[HeartbeatCheck ${personaDisplayName}] No parsed result`);
    return;
  }
  console.log(`[HeartbeatCheck ${personaDisplayName}] Parsed result - should_respond: ${result.should_respond}, topic: ${result.topic ?? '(none)'}, message: ${result.message ? '(present)' : '(none)'}`);

  const now = new Date().toISOString();
  state.persona_update(personaId, { last_heartbeat: now });
  state.queue_clearPersonaResponses(personaId, LLMNextStep.HandleHeartbeatCheck);

  if (!result.should_respond) {
    console.log(`[HeartbeatCheck ${personaDisplayName}] Chose not to reach out (should_respond=false)`);
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
    state.messages_append(personaId, message);
    console.log(`[HeartbeatCheck ${personaDisplayName}] Added proactive message - topic: ${result.topic ?? 'general'}, message: "${result.message.substring(0, 100)}${result.message.length > 100 ? '...' : ''}"`);
  } else {
    console.log(`[HeartbeatCheck ${personaDisplayName}] should_respond=true but no message provided`);
  }
}

export function handleEiHeartbeat(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as EiHeartbeatResult | undefined;
  if (!result) {
    console.error("[EiHeartbeat] No parsed result");
    return;
  }
  console.log(`[EiHeartbeat] Parsed result - should_respond: ${result.should_respond}, id: ${result.id ?? '(none)'}, my_response: ${result.my_response ? '(present)' : '(none)'}`);
  const now = new Date().toISOString();
  state.persona_update("ei", { last_heartbeat: now });
  state.queue_clearPersonaResponses("ei", LLMNextStep.HandleEiHeartbeat);
  if (!result.should_respond || !result.id) {
    console.log("[EiHeartbeat] Chose not to reach out (should_respond=false or no id)");
    return;
  }
  const isTUI = response.request.data.isTUI as boolean;
  const found = crossFind(result.id, state.getHuman(), state.persona_getAll());
  if (!found) {
    console.warn(`[handleEiHeartbeat] Could not find item with id "${result.id}"`);
    return;
  }

  const sendMessage = (content: string) => state.messages_append("ei", {
    id: crypto.randomUUID(),
    role: "system",
    content,
    timestamp: now,
    read: false,
    context_status: ContextStatus.Default,
    f: true, t: true, p: true,
  });

  if (found.type === "fact") {
    const factsNav = isTUI ? "using /me facts" : "using \u2630 \u2192 My Data";
    sendMessage(`Another persona updated a fact called "${found.name}" to "${found.description}". If that's right, you can lock it from further changes by ${factsNav}.`);
    state.human_fact_upsert({ ...found, validated_date: now });
    console.log(`[handleEiHeartbeat] Notified about fact "${found.name}"`);
    return;
  }

  if (result.my_response) {
    console.log(`[EiHeartbeat] Sending message: "${result.my_response.substring(0, 100)}${result.my_response.length > 100 ? '...' : ''}"`);
    sendMessage(result.my_response);
  }

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

  const newPersonIds = (response.request.data.newPersonIds ?? []) as string[];
  if (newPersonIds.length > 0) {
    const human = state.getHuman();
    for (const personId of newPersonIds) {
      const person = human.people.find(p => p.id === personId);
      if (person) {
        state.human_person_upsert({ ...person, validated_date: now });
      }
    }
  }
}

export function handleReflectionCritic(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;

  const result = response.parsed as ReflectionCriticResult | undefined;
  if (!result?.updated_identity || !result.critique) {
    console.error(`[ReflectionCritic ${personaDisplayName}] Invalid or missing parsed result`);
    return;
  }

  const personRecord = state.human_person_getByIdentifier("Ei Persona", personaId);
  if (personRecord) {
    state.human_person_upsert({
      ...personRecord,
      description: result.updated_identity.long_description,
    });
    console.log(`[ReflectionCritic ${personaDisplayName}] Person record description replaced (was log, now distilled identity)`);
  }

  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ReflectionCritic ${personaDisplayName}] Persona not found after critic`);
    return;
  }

  const mergedTopics = result.updated_identity.topics.map(updatedTopic => {
    const existing = persona.topics.find(t => t.name === updatedTopic.name);
    return {
      ...updatedTopic,
      sentiment: updatedTopic.sentiment ?? existing?.sentiment ?? 0,
      exposure_current: updatedTopic.exposure_current ?? existing?.exposure_current ?? 0,
      exposure_desired: updatedTopic.exposure_desired ?? existing?.exposure_desired ?? 0.5,
    };
  });

  const sanitizedTraits = result.updated_identity.traits.map(t => ({
    ...t,
    name: t.name?.trim() ?? "",
    description: t.description?.trim() ?? "",
  }));

  const sanitizedTopics = mergedTopics.map(t => ({
    ...t,
    name: t.name?.trim() ?? "",
  }));

  state.persona_update(personaId, {
    pending_update: {
      short_description: result.updated_identity.short_description?.trim() ?? "",
      long_description: result.updated_identity.long_description?.trim() ?? "",
      traits: sanitizedTraits,
      topics: sanitizedTopics,
      critique: result.critique,
      created_at: new Date().toISOString(),
    },
  });
  console.log(`[ReflectionCritic ${personaDisplayName}] pending_update written to persona`);
}
