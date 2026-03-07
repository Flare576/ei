import {
  ContextStatus,
  type LLMResponse,
  type Message,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaResponseResult } from "../../prompts/response/index.js";

export type ResponseHandler = (response: LLMResponse, state: StateManager) => void | Promise<void>;

export function handlePersonaResponse(response: LLMResponse, state: StateManager): void {
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
          context_status: ContextStatus.Default,
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

/**
 * handleToolSynthesis — second LLM call in the tool flow.
 * The QueueProcessor already injected tool history into messages and got the
 * final persona response. Parse and store it exactly like handlePersonaResponse.
 */
export function handleToolSynthesis(response: LLMResponse, state: StateManager): void {
  console.log(`[handleToolSynthesis] Routing to handlePersonaResponse`);
  handlePersonaResponse(response, state);
}

export function handleOneShot(_response: LLMResponse, _state: StateManager): void {
  // One-shot is handled specially in Processor to fire onOneShotReturned
  // This handler is a no-op placeholder
}
