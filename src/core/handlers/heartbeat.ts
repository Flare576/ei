import {
  ContextStatus,
  ValidationLevel,
  type LLMResponse,
  type Message,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { HeartbeatCheckResult, EiHeartbeatResult } from "../../prompts/heartbeat/types.js";
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

export function handleEiHeartbeat(response: LLMResponse, state: StateManager): void {
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
    f: true, r: true, p: true, o: true,
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
