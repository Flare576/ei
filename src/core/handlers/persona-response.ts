import {
  ContextStatus,
  LLMNextStep,
  type LLMResponse,
  type Message,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaResponseResult } from "../../prompts/response/index.js";
import { handlers } from "./index.js";

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
 * handleToolContinuation — second LLM call in the tool flow (may loop if LLM calls more tools).
 * The QueueProcessor already injected tool history into messages and got the
 * final persona response. Route to the original handler based on originalNextStep in data.
 */
export function handleToolContinuation(response: LLMResponse, state: StateManager): void {
  const originalStep = response.request.data.originalNextStep as LLMNextStep | undefined;
  
  if (!originalStep) {
    console.error(`[handleToolContinuation] No originalNextStep in data, falling back to handlePersonaResponse`);
    handlePersonaResponse(response, state);
    return;
  }
  
  console.log(`[handleToolContinuation] Original request was ${originalStep}, routing accordingly`);
  
  const handler = handlers[originalStep];
  
  if (!handler) {
    console.error(`[handleToolContinuation] No handler found for ${originalStep}, falling back to handlePersonaResponse`);
    handlePersonaResponse(response, state);
    return;
  }
  
  // Avoid infinite loop - if original was already HandleToolContinuation, go to PersonaResponse
  if (originalStep === "handleToolContinuation") {
    console.log(`[handleToolContinuation] Original was tool continuation, routing to handlePersonaResponse`);
    handlePersonaResponse(response, state);
    return;
  }
  
  handler(response, state);
}

export function handleOneShot(_response: LLMResponse, _state: StateManager): void {
  // One-shot is handled specially in Processor to fire onOneShotReturned
  // This handler is a no-op placeholder
}
