import {
  ContextStatus,
  LLMNextStep,
  type LLMResponse,
  type Message,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { HeartbeatCheckResult, EiHeartbeatResult } from "../../prompts/heartbeat/types.js";
import { crossFind } from "../utils/index.js";
import { qualifyEiMessage } from "../utils/message-id.js";
import { stripControlChars } from "../utils/message-refusal.js";

export function handleHeartbeatCheck(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    throw new Error("[handleHeartbeatCheck] No personaId in request data");
  }

  const result = response.parsed as HeartbeatCheckResult | undefined;
  if (!result) {
    throw new Error(`[HeartbeatCheck ${personaDisplayName}] No parsed result`);
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
      id: qualifyEiMessage(crypto.randomUUID()),
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
    throw new Error("[EiHeartbeat] No parsed result");
  }
  console.log(`[EiHeartbeat] Parsed result - should_respond: ${result.should_respond}, id: ${stripControlChars(String(result.id ?? '(none)'))}, my_response: ${result.my_response ? '(present)' : '(none)'}`);
  // D6 (Bolt-006 review I5): validate my_response's shape before any state
  // mutation below. my_response is optional (omitted is fine — no message to
  // send), but if present it must be a non-empty string; anything else is a
  // malformed response that must fail the request through the normal
  // retry/DLQ path with last_heartbeat and the queued response untouched.
  if (result.my_response !== undefined && (typeof result.my_response !== "string" || result.my_response.length === 0)) {
    throw new Error(`[EiHeartbeat] Malformed my_response: expected a non-empty string, got ${typeof result.my_response}`);
  }
  // bolt-persona-emergence-signals-011, D5 (amended after Beta's wave-1
  // fix-confirmation, 2026-08-11 -- the first attempt placed this guard
  // after state.persona_update/state.queue_clearPersonaResponses below, so
  // a non-offered id still stamped last_heartbeat and cleared the queued
  // response even though it correctly avoided fact/person/topic mutation):
  // crossFind below resolves any known fact/person/topic/persona/signal id
  // globally -- it has no notion of which ids THIS request actually
  // offered. The queued request's own offeredIds snapshot (heartbeat-
  // manager.ts's queueEiHeartbeat, D5) is the sole authorization boundary:
  // a present id the model names that was never offered in this request is
  // rejected here -- the very first thing this function does once a
  // present id is confirmed, before ANY state write of any kind (no
  // last_heartbeat stamp, no queue clear, no crossFind call, no
  // fact/person/topic mutation) -- never merely logged after the fact. The
  // documented id-less Temporal Anchor path (result.id === undefined) never
  // reaches this guard at all and is completely unaffected by it.
  if (result.id !== undefined) {
    const offeredIds = response.request.data.offeredIds as string[] | undefined;
    if (!offeredIds?.includes(result.id)) {
      console.warn(`[handleEiHeartbeat] Rejected id "${stripControlChars(String(result.id))}" -- not present in this request's offered-id snapshot`);
      return;
    }
  }

  const now = new Date().toISOString();
  state.persona_update("ei", { last_heartbeat: now });
  state.queue_clearPersonaResponses("ei", LLMNextStep.HandleEiHeartbeat);
  if (!result.should_respond) {
    console.log("[EiHeartbeat] Chose not to reach out (should_respond=false)");
    return;
  }

  const sendMessage = (content: string) => state.messages_append("ei", {
    id: qualifyEiMessage(crypto.randomUUID()),
    role: "system",
    content,
    timestamp: now,
    read: false,
    context_status: ContextStatus.Default,
    f: true, t: true, p: true,
  });

  if (result.id === undefined) {
    // ei.ts's own Temporal Anchor contract (no id needed) — should_respond=true
    // with no id is a deliberate response, never equivalent to
    // should_respond=false, and must not be silently dropped (Spec §4.10, D2).
    if (result.my_response) {
      console.log(`[EiHeartbeat] Sending message (Temporal Anchor): "${stripControlChars(result.my_response).substring(0, 100)}${result.my_response.length > 100 ? '...' : ''}"`);
      sendMessage(result.my_response);
    } else {
      console.log("[EiHeartbeat] should_respond=true but no id and no my_response provided");
    }
    return;
  }

  const isTUI = response.request.data.isTUI as boolean;
  const found = crossFind(result.id, state.getHuman(), state.persona_getAll(), (personaId) => state.signals_get(personaId));
  if (!found) {
    console.warn(`[handleEiHeartbeat] Could not find item with id "${stripControlChars(String(result.id))}"`);
    return;
  }

  if (found.type === "fact") {
    const factsNav = isTUI ? "using /me facts" : "using \u2630 \u2192 My Data";
    sendMessage(`Another persona updated a fact called "${found.name}" to "${found.description}". If that's right, you can lock it from further changes by ${factsNav}.`);
    state.human_fact_upsert({ ...found, validated_date: now });
    console.log(`[handleEiHeartbeat] Notified about fact "${found.name}"`);
    return;
  }

  if (result.my_response) {
    console.log(`[EiHeartbeat] Sending message: "${stripControlChars(result.my_response).substring(0, 100)}${result.my_response.length > 100 ? '...' : ''}"`);
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
    case "signal":
      console.log(`[handleEiHeartbeat] Reached out about signal "${found.id}" (persona ${found.personaId}, ${found.lens} lens)`);
      break;
    default:
      console.warn(`[handleEiHeartbeat] Unexpected item type "${found.type}" for id "${stripControlChars(String(result.id))}"`);
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
