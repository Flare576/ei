import {
  ContextStatus,
  LLMNextStep,
  type LLMResponse,
  type Message,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaResponseResult } from "../../prompts/response/index.js";
import { handlers } from "./index.js";
import { cleanResponseContent } from "../llm-client.js";

export type ResponseHandler = (response: LLMResponse, state: StateManager) => void | Promise<void>;

export function handlePersonaResponse(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    throw new Error("[handlePersonaResponse] No personaId in request data");
  }

  state.messages_markPendingAsRead(personaId);

  const raw = cleanResponseContent(response.content ?? "").trim();

  if (raw.length > 0) {
    const lines = raw.split('\n');
    const isNoResponse = lines[0].replace(/[^a-zA-Z]/g, '').toLowerCase() === 'noresponse';

    if (isNoResponse) {
      const reason = lines.slice(1).join('\n').trim();
      console.log(`[silence] ${personaDisplayName}: ${reason || "(no reason given)"}`);
      const silentMessage: Message = {
        id: crypto.randomUUID(),
        role: "system",
        silence_reason: reason || undefined,
        timestamp: new Date().toISOString(),
        read: false,
        context_status: ContextStatus.Default,
      };
      state.messages_append(personaId, silentMessage);
    } else {
      const message: Message = {
        id: crypto.randomUUID(),
        role: "system",
        content: raw,
        timestamp: new Date().toISOString(),
        read: false,
        context_status: ContextStatus.Default,
      };
      state.messages_append(personaId, message);
      console.log(`[handlePersonaResponse] Appended Markdown response to ${personaDisplayName}`);
    }
    return;
  }

  if (response.parsed !== undefined) {
    const result = response.parsed as PersonaResponseResult;

    if (!result.should_respond) {
      const reason = result.reason;
      if (reason) {
        console.log(`[silence] ${personaDisplayName}: ${reason}`);
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
        console.log(`[silence] ${personaDisplayName}: (no reason given)`);
      }
      return;
    }

    const content = result.content || undefined;

    if (!content) {
      console.log(`[handlePersonaResponse] ${personaDisplayName} JSON had should_respond=true but no content fields`);
      return;
    }

    const message: Message = {
      id: crypto.randomUUID(),
      role: "system",
      content,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: ContextStatus.Default,
    };
    state.messages_append(personaId, message);
    console.log(`[handlePersonaResponse] Appended structured response to ${personaDisplayName}`);
    return;
  }

  console.warn(`[silence] ${personaDisplayName}: empty response after cleaning`);
}

/**
 * handleToolContinuation — second LLM call in the tool flow (may loop if LLM calls more tools).
 * The QueueProcessor already injected tool history into messages and got the
 * final persona response. Route to the original handler based on originalNextStep in data.
 */
export function handleToolContinuation(response: LLMResponse, state: StateManager): void {
  const originalStep = response.request.data.originalNextStep as LLMNextStep | undefined;
  
  if (!originalStep) {
    console.warn(`[handleToolContinuation] No originalNextStep in data, falling back to handlePersonaResponse`);
    handlePersonaResponse(response, state);
    return;
  }
  
  console.log(`[handleToolContinuation] Original request was ${originalStep}, routing accordingly`);
  
  const handler = handlers[originalStep];
  
  if (!handler) {
    console.warn(`[handleToolContinuation] No handler found for ${originalStep}, falling back to handlePersonaResponse`);
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

export function handleOneShotJSON(_response: LLMResponse, _state: StateManager): void {
  // One-shot JSON is handled specially in Processor to fire onOneShotJSONReturned
  // This handler is a no-op placeholder
}
